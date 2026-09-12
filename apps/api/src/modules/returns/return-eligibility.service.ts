import { Injectable } from '@nestjs/common';
import { ReturnStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreSettingsService } from '../store-settings/store-settings.service';

const DEFAULT_RETURN_WINDOW_DAYS = 14;
/** Return requests still "active" (not rejected/cancelled) count against the purchased quantity - see §8. */
const ACTIVE_RETURN_STATUSES: ReturnStatus[] = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'COMPLETED'];

export interface EligibleOrderItem {
  orderItemId: string;
  productId: string | null;
  variantId: string | null;
  productNameSnapshot: string;
  purchasedQuantity: number;
  alreadyReturnedQuantity: number;
  maxReturnableQuantity: number;
  unitPrice: string;
}

export interface ReturnEligibility {
  eligible: boolean;
  reason?: string;
  deliveredAt?: Date;
  returnWindowDays: number;
  eligibleUntil?: Date;
  items: EligibleOrderItem[];
}

/**
 * §10/§11 - the ONE place eligibility is computed, entirely server-side.
 * Never trusts a client-supplied deliveredAt/eligibleUntil/requestedAt (§11)
 * - the authoritative delivered timestamp is read directly from
 * OrderStatusHistory's own DELIVERED transition (the existing, already-
 * correct source - no second delivery timestamp is invented anywhere).
 */
@Injectable()
export class ReturnEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  async getReturnWindowDays(storeId: string): Promise<number> {
    const settings = await this.storeSettingsService.getAllSettings(storeId);
    const raw = settings['RETURN_WINDOW_DAYS'];
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETURN_WINDOW_DAYS;
  }

  async checkOrderEligibility(storeId: string, orderNumber: string, userId?: string): Promise<ReturnEligibility> {
    const order = await this.prisma.order.findFirst({
      where: { storeId, orderNumber, ...(userId ? { userId } : {}) },
      include: { items: true },
    });
    const returnWindowDays = await this.getReturnWindowDays(storeId);
    if (!order) {
      return { eligible: false, reason: 'Order not found', returnWindowDays, items: [] };
    }
    if (order.status !== 'DELIVERED') {
      return { eligible: false, reason: `Order status is ${order.status} - only DELIVERED orders are eligible for return`, returnWindowDays, items: [] };
    }

    const deliveredTransition = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId: order.id, newStatus: 'DELIVERED' },
      orderBy: { createdAt: 'asc' },
    });
    // Defensive only - every DELIVERED order in this codebase's own lifecycle
    // always has a matching history row (OrderStatusService writes one on
    // every transition it makes); this never actually triggers in practice.
    const deliveredAt = deliveredTransition?.createdAt ?? order.updatedAt;
    const eligibleUntil = new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000);
    const windowOpen = new Date() <= eligibleUntil;

    const items: EligibleOrderItem[] = [];
    for (const item of order.items) {
      const alreadyReturned = await this.prisma.returnItem.aggregate({
        where: { orderItemId: item.id, returnRequest: { status: { in: ACTIVE_RETURN_STATUSES } } },
        _sum: { quantity: true },
      });
      const alreadyReturnedQuantity = alreadyReturned._sum.quantity ?? 0;
      items.push({
        orderItemId: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productNameSnapshot: item.productNameSnapshot,
        purchasedQuantity: item.quantity,
        alreadyReturnedQuantity,
        maxReturnableQuantity: Math.max(0, item.quantity - alreadyReturnedQuantity),
        unitPrice: item.unitPrice.toFixed(2),
      });
    }

    if (!windowOpen) {
      return { eligible: false, reason: `The ${returnWindowDays}-day return window has ended`, deliveredAt, returnWindowDays, eligibleUntil, items };
    }
    const anyReturnable = items.some((i) => i.maxReturnableQuantity > 0);
    if (!anyReturnable) {
      return { eligible: false, reason: 'Every item on this order has already been returned', deliveredAt, returnWindowDays, eligibleUntil, items };
    }

    return { eligible: true, deliveredAt, returnWindowDays, eligibleUntil, items };
  }
}
