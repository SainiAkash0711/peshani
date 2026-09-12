import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * §19/§20/§21/§22 - the ONE place a refund amount is ever computed. Never
 * accepts a client-supplied amount (the create-return DTO does not even
 * declare a refundAmount field). Two responsibilities, each load-bearing:
 *
 * 1. calculateItemRefund() - per-OrderItem refund for a given return
 *    quantity, allocating the ORDER's own discountAmount proportionally
 *    across items by each item's share of the order subtotal (§20) so a
 *    coupon/promotion discount is never ignored - refunding
 *    "unitPrice x quantity" alone for a discounted order would refund MORE
 *    than the customer actually paid, which this explicitly prevents.
 *    Shipping is deliberately never included (§21's conservative default -
 *    "product/item refund only, shipping refund = 0" - no store
 *    configuration for this exists yet, so the conservative default is the
 *    only behavior).
 *
 * 2. getRefundableBalance() - the hard, authoritative ceiling (§22):
 *    captured payment amount minus every refund already PENDING/PROCESSING/
 *    SUCCEEDED for that order (a refund that later fails releases its own
 *    hold implicitly, since only non-terminal-failure statuses count here).
 *    RefundService caps every calculated amount against this before ever
 *    creating a Refund row or calling the provider - the true money-safety
 *    boundary, independent of anything the per-item math above computed.
 */
@Injectable()
export class RefundCalculationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `orderItem`/`order` are passed in (not re-fetched) so callers already
   * holding them inside a transaction never trigger an extra query - the
   * exact same "read immutable snapshot data before/without an extra
   * in-transaction round trip" discipline established in Phase 9's own
   * transaction-latency correction.
   */
  calculateItemRefund(
    order: { subtotal: Prisma.Decimal; discountAmount: Prisma.Decimal },
    orderItem: { unitPrice: Prisma.Decimal; quantity: number; lineTotal: Prisma.Decimal },
    returnQuantity: number,
  ): Prisma.Decimal {
    const subtotal = order.subtotal;
    const discount = order.discountAmount;
    if (subtotal.lessThanOrEqualTo(0) || discount.lessThanOrEqualTo(0)) {
      return orderItem.unitPrice.mul(returnQuantity).toDecimalPlaces(2);
    }
    // This item's total allocated discount (for its FULL purchased
    // quantity), proportional to its share of the order subtotal.
    const itemDiscountShare = discount.mul(orderItem.lineTotal).div(subtotal);
    const discountPerUnit = itemDiscountShare.div(orderItem.quantity);
    const grossForReturnQty = orderItem.unitPrice.mul(returnQuantity);
    const discountForReturnQty = discountPerUnit.mul(returnQuantity);
    const net = grossForReturnQty.sub(discountForReturnQty);
    // Never negative (a pathological discount larger than the item's own
    // price is not possible given how discounts are capped elsewhere in
    // this codebase, but this stays a hard floor regardless).
    return (net.lessThan(0) ? new Prisma.Decimal(0) : net).toDecimalPlaces(2);
  }

  /**
   * §22 - authoritative refundable ceiling for one Payment. Reads via
   * whichever Prisma client the caller passes (a `tx` when this must be
   * checked atomically alongside a new Refund's creation - see
   * RefundService.initiate()).
   */
  async getRefundableBalance(client: Prisma.TransactionClient | PrismaService, paymentId: string, capturedAmount: Prisma.Decimal): Promise<Prisma.Decimal> {
    const alreadyRefunded = await client.refund.aggregate({
      where: { paymentId, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
      _sum: { amount: true },
    });
    const committed = alreadyRefunded._sum.amount ?? new Prisma.Decimal(0);
    const remaining = capturedAmount.sub(committed);
    return remaining.lessThan(0) ? new Prisma.Decimal(0) : remaining;
  }
}
