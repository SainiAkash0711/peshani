import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, OrderStatusChangeSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InventoryService } from '../inventory/inventory.service';
import { CouponRedemptionService } from '../promotions/coupon-redemption.service';
import { OutboxService } from '../notifications/outbox.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';

const ORDER_LIFECYCLE_EVENT_TYPES: Partial<Record<OrderStatus, string>> = {
  CANCELLED: 'ORDER_CANCELLED',
  SHIPPED: 'ORDER_SHIPPED',
  DELIVERED: 'ORDER_DELIVERED',
};

interface TransitionOptions {
  source: OrderStatusChangeSource;
  reason?: string;
}

/**
 * Phase 6 §11 - the ONE place every fulfillment-lifecycle status change for
 * an Order passes through (never scattered across controllers). Handles
 * everything EXCEPT the two transitions PaymentService already owns
 * (PENDING_PAYMENT -> CONFIRMED on real payment verification, and its own
 * genuine-failure PENDING_PAYMENT -> CANCELLED) - see that service's own
 * doc comments; this service's transition matrix deliberately does not list
 * CONFIRMED as a reachable target for that reason.
 *
 * Every transition (including fulfill()) is atomic-conditional: the
 * `Order.updateMany({where: {status: currentStatus}})` guard is what makes
 * two concurrent requests against the same order resolve to exactly one
 * successful transition, the other a controlled 409 (Phase 6 §12/§34 Race 1).
 */
@Injectable()
export class OrderStatusService {
  /**
   * PENDING_PAYMENT and CONFIRMED are read-reachable "from" states here only
   * for CANCELLED - CONFIRMED is never a "to" target since only
   * PaymentService may confirm an order (see class doc comment). PACKED is
   * only ever reached via fulfill(), never via this generic transition() map.
   */
  private static readonly ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    PENDING_PAYMENT: ['CANCELLED'],
    CONFIRMED: ['PROCESSING', 'CANCELLED'],
    PROCESSING: ['CANCELLED'],
    PACKED: ['SHIPPED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  /** States a CUSTOMER (as opposed to an ADMIN) may cancel from - once an admin has started processing, only an admin may cancel. */
  private static readonly CUSTOMER_CANCELLABLE_FROM: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly inventoryService: InventoryService,
    private readonly couponRedemptionService: CouponRedemptionService,
    private readonly outboxService: OutboxService,
  ) {}

  async transition(
    storeId: string,
    orderNumber: string,
    targetStatus: Exclude<OrderStatus, 'PENDING_PAYMENT' | 'CONFIRMED' | 'PACKED'>,
    actor: AuthenticatedUser,
    options: TransitionOptions,
  ) {
    const order = await this.getScopedOrThrow(storeId, orderNumber, options.source === 'CUSTOMER' ? actor.userId : undefined);

    const allowedTargets = OrderStatusService.ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowedTargets.includes(targetStatus)) {
      throw new ConflictException(`Cannot transition an order from ${order.status} to ${targetStatus}`);
    }
    if (
      options.source === 'CUSTOMER' &&
      targetStatus === 'CANCELLED' &&
      !OrderStatusService.CUSTOMER_CANCELLABLE_FROM.includes(order.status)
    ) {
      throw new ConflictException(`This order can no longer be cancelled - it is already ${order.status}`);
    }

    const previousStatus = order.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({ where: { id: order.id, status: previousStatus }, data: { status: targetStatus } });
      if (result.count === 0) {
        throw new ConflictException('This order was modified concurrently - please refresh and try again');
      }

      if (targetStatus === 'CANCELLED') {
        // Micro-correction §1/§5: cancellation NEVER touches Payment. A
        // CAPTURED payment stays exactly CAPTURED - it is never flipped to
        // FAILED/CANCELLED, and no refund is issued or claimed anywhere in
        // this codebase (no refund feature exists - out of scope for Phase
        // 6, see the Phase 6 prompt's own scope boundary). The resulting
        // state (Payment CAPTURED + Order CANCELLED) is the honest,
        // observable signal that money was captured for an order that will
        // not be fulfilled and requires a manual refund/reconciliation
        // process - a known, documented operational limitation, not a bug
        // and not something this phase invents automation for.
        await this.releaseOrderReservations(tx, storeId, order.id, actor);
        // Phase 7 §38/§80: releases a still-RESERVED coupon redemption
        // (a PENDING_PAYMENT order that never completed payment) - a
        // harmless no-op for a CONFIRMED-or-later order, whose redemption
        // (if any) is already CONSUMED by the time it could reach here, and
        // release() only ever touches RESERVED rows. CONSUMED usage is
        // never restored on cancellation - see CouponRedemptionService's
        // own doc comment for the full policy.
        await this.couponRedemptionService.release(tx, order.id);
      }

      await tx.orderStatusHistory.create({
        data: {
          storeId,
          orderId: order.id,
          previousStatus,
          newStatus: targetStatus,
          changedByUserId: actor.userId,
          source: options.source,
          reason: options.reason,
        },
      });

      // Phase 9 §13/§30 - written in the SAME transaction as the status
      // change itself, so a rollback (e.g. the concurrency guard above)
      // never leaves a stray notification for a transition that didn't
      // actually happen, and a crash right after commit can never lose it.
      const eventType = ORDER_LIFECYCLE_EVENT_TYPES[targetStatus];
      if (eventType) {
        await this.outboxService.record(tx, {
          storeId,
          eventType,
          aggregateType: 'Order',
          aggregateId: order.id,
          idempotencyKey: `${eventType}:${order.id}`,
          payload: this.buildNotificationPayload(order, targetStatus),
        });
      }

      return tx.order.findUniqueOrThrow({ where: { id: order.id } });
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: `Order${capitalize(targetStatus)}`,
      entityType: 'Order',
      entityId: order.id,
      metadata: { orderNumber, previousStatus, newStatus: targetStatus, source: options.source, reason: options.reason },
    });

    return updated;
  }

  /**
   * The ONLY path to PACKED - folds the status transition and the physical
   * inventory consumption into one atomic operation (Phase 6 §13/§16),
   * guarded by the `fulfilledAt: null` conditional claim below so calling
   * this twice for the same order consumes stock exactly once (§15, Race 2).
   */
  async fulfill(storeId: string, orderNumber: string, actor: AuthenticatedUser, options: { reason?: string } = {}) {
    const order = await this.getScopedOrThrow(storeId, orderNumber);

    if (order.status !== 'PROCESSING') {
      throw new ConflictException(`Cannot fulfill an order with status ${order.status} - it must be PROCESSING`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: 'PROCESSING', fulfilledAt: null },
        data: { status: 'PACKED', fulfilledAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('This order has already been fulfilled or its status changed concurrently');
      }

      await this.inventoryService.fulfillOrderReservations(storeId, order.id, actor, tx);

      await tx.orderStatusHistory.create({
        data: {
          storeId,
          orderId: order.id,
          previousStatus: 'PROCESSING',
          newStatus: 'PACKED',
          changedByUserId: actor.userId,
          source: 'ADMIN',
          reason: options.reason,
        },
      });

      await this.outboxService.record(tx, {
        storeId,
        eventType: 'ORDER_PACKED',
        aggregateType: 'Order',
        aggregateId: order.id,
        idempotencyKey: `ORDER_PACKED:${order.id}`,
        payload: this.buildNotificationPayload(order, 'PACKED'),
      });

      return tx.order.findUniqueOrThrow({ where: { id: order.id } });
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'OrderFulfilled',
      entityType: 'Order',
      entityId: order.id,
      metadata: { orderNumber, reason: options.reason },
    });

    return updated;
  }

  async getHistory(storeId: string, orderNumber: string, requireOwnerId?: string) {
    const order = await this.getScopedOrThrow(storeId, orderNumber, requireOwnerId);
    return this.prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Releases whatever is still holding stock for this order (ACTIVE or
   * COMMITTED - never both share a line, see the reservation state
   * machine) via the correct method for each - never released by expiry, and
   * never bypasses either method's own atomic conditional-update safety.
   */
  private async releaseOrderReservations(tx: Prisma.TransactionClient, storeId: string, orderId: string, actor: AuthenticatedUser): Promise<void> {
    const reservations = await tx.stockReservation.findMany({ where: { orderId, status: { in: ['ACTIVE', 'COMMITTED'] } } });
    for (const reservation of reservations) {
      if (reservation.status === 'ACTIVE') {
        await this.inventoryService.release(storeId, reservation.id, actor, tx);
      } else {
        await this.inventoryService.releaseCommitted(storeId, reservation.id, actor, tx);
      }
    }
  }

  /** Only non-sensitive, already order-visible fields - never a token/secret (§28). */
  private buildNotificationPayload(order: { id: string; userId: string; orderNumber: string; totalAmount: unknown; currency: string; customerEmail: string; billingAddress: unknown; shippingMethodNameSnapshot: string | null }, status: string) {
    const billing = order.billingAddress as { fullName?: string } | null;
    return {
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderTotal: `${order.currency} ${Number(order.totalAmount).toFixed(2)}`,
      customerName: billing?.fullName ?? order.customerEmail,
      shippingMethod: order.shippingMethodNameSnapshot ?? '',
      status,
    };
  }

  /** Same safe-404 convention as OrderService.getScopedOrderOrThrow - an unknown or wrong-tenant/wrong-owner order is indistinguishable from a genuinely nonexistent one (never a 403 that would confirm existence). */
  private async getScopedOrThrow(storeId: string, orderNumber: string, requireOwnerId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { storeId, orderNumber, ...(requireOwnerId ? { userId: requireOwnerId } : {}) },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }
}

function capitalize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
