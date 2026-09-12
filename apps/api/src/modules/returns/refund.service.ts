import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Refund } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OutboxService } from '../notifications/outbox.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { toMinorUnits } from '../../common/utils/money.util';
import { REFUND_PROVIDER, RefundProvider } from '../payments/providers/refund-provider.interface';
import { RefundCalculationService } from './refund-calculation.service';
import { MetricsService } from '../../common/metrics/metrics.service';

const NON_TERMINAL_REFUND_STATUSES = ['PENDING', 'PROCESSING'];

/**
 * §4/§18/§24/§25/§26 - real money moves through this service. Every method
 * distinguishes "the provider told us it failed" (FAILED) from "we don't
 * yet know what happened" (UNKNOWN) - the second is NEVER auto-retried,
 * because a blind retry after a lost response could create a genuine
 * duplicate refund. This mirrors PaymentService's own established recovery
 * architecture for payment orders (createOrRecoverPaymentSession/
 * ensureProviderOrder) applied to refunds instead.
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly outboxService: OutboxService,
    private readonly refundCalculation: RefundCalculationService,
    @Inject(REFUND_PROVIDER) private readonly provider: RefundProvider,
    private readonly metrics: MetricsService,
  ) {}

  /** Mirrors PaymentService's own buildOrderNotificationPayload - immutable order snapshot fields only, read via `this.prisma` (never a `tx`), always before opening any transaction (see Phase 9's own transaction-latency correction). */
  private async buildNotificationPayload(orderId: string, extra: Record<string, unknown>) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNumber: true, customerEmail: true, billingAddress: true },
    });
    const billing = order.billingAddress as { fullName?: string } | null;
    return { orderNumber: order.orderNumber, customerName: billing?.fullName ?? order.customerEmail, ...extra };
  }

  /**
   * §25 - idempotency key is deterministic: "RETURN_REFUND:<returnRequestId>"
   * for the first attempt. If that attempt reaches a genuinely terminal
   * FAILED state, a NEW attempt gets its own suffixed key
   * ("...:retry-<n>") - never a random value, and never more than one
   * attempt is ever non-terminal (PENDING/PROCESSING/UNKNOWN) at a time for
   * the same ReturnRequest, enforced by re-using the latest existing row
   * whenever one is already non-terminal or already SUCCEEDED.
   */
  async initiate(storeId: string, actor: AuthenticatedUser, returnRequestId: string): Promise<Refund> {
    const returnRequest = await this.prisma.returnRequest.findFirst({ where: { id: returnRequestId, storeId }, include: { items: true } });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }
    if (returnRequest.status !== 'REFUND_PENDING') {
      throw new ConflictException(`Cannot initiate a refund for a return with status ${returnRequest.status} - it must be REFUND_PENDING (fully inspected)`);
    }

    const existingLatest = await this.prisma.refund.findFirst({ where: { returnRequestId }, orderBy: { createdAt: 'desc' } });
    if (existingLatest) {
      if (existingLatest.status === 'SUCCEEDED' || NON_TERMINAL_REFUND_STATUSES.includes(existingLatest.status)) {
        return existingLatest; // idempotent no-op - already succeeded or already in flight.
      }
      if (existingLatest.status === 'UNKNOWN') {
        throw new ConflictException('The previous refund attempt for this return has an unknown provider outcome - resolve it via recovery before initiating a new attempt');
      }
      // FAILED or CANCELLED - a genuinely terminal non-success state. A new
      // attempt is safe (§26's own "genuine retry after a terminal FAILED
      // attempt" precedent from PaymentService).
    }

    const payment = await this.prisma.payment.findFirst({ where: { orderId: returnRequest.orderId, status: 'CAPTURED' } });
    if (!payment || !payment.providerPaymentId) {
      throw new ConflictException('No captured payment was found for this order - a refund cannot be initiated');
    }

    const totalCalculated = returnRequest.items.reduce((sum, item) => sum.add(item.refundAmount), new Prisma.Decimal(0));
    const attemptSuffix = existingLatest ? `:retry-${(await this.prisma.refund.count({ where: { returnRequestId } })) + 1}` : '';
    const idempotencyKey = `RETURN_REFUND:${returnRequestId}${attemptSuffix}`;
    const orderNotificationFields = await this.buildNotificationPayload(returnRequest.orderId, {});

    const created = await this.prisma.$transaction(async (tx) => {
      // §22/§25/§43 - serializes concurrent refund attempts against the SAME
      // captured payment (this return, or any other return against the
      // same order/payment) so the refundable-balance check below is never
      // read-then-written against a stale value by two simultaneous callers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`refund:payment:${payment.id}`}))`;

      // Re-check for an existing row NOW THAT the lock is held - up to 9 of
      // 10 simultaneous initiate() calls queue behind the lock while the
      // winner creates the row below; each loser must find it here and
      // return it directly, never attempt a second `create()` with the
      // same idempotencyKey (which would otherwise throw a raw unique-
      // constraint error instead of resolving to "one logical refund").
      const raceWinner = await tx.refund.findUnique({ where: { idempotencyKey } });
      if (raceWinner) {
        return { refund: raceWinner, isNew: false };
      }

      const refundableBalance = await this.refundCalculation.getRefundableBalance(tx, payment.id, payment.amount);
      const cappedAmount = totalCalculated.greaterThan(refundableBalance) ? refundableBalance : totalCalculated;
      if (cappedAmount.lessThanOrEqualTo(0)) {
        throw new ConflictException('Nothing remains refundable for this payment - it has already been fully refunded');
      }

      const refund = await tx.refund.create({
        data: {
          storeId,
          orderId: returnRequest.orderId,
          paymentId: payment.id,
          returnRequestId,
          amount: cappedAmount,
          currency: payment.currency,
          status: 'PENDING',
          idempotencyKey,
        },
      });

      const transitioned = await tx.returnRequest.updateMany({ where: { id: returnRequestId, storeId, status: 'REFUND_PENDING' }, data: { status: 'REFUND_INITIATED', refundInitiatedAt: new Date() } });
      if (transitioned.count === 0) {
        throw new ConflictException('This return was modified concurrently - please refresh and try again');
      }

      await this.outboxService.record(tx, {
        storeId,
        eventType: 'REFUND_INITIATED',
        aggregateType: 'Refund',
        aggregateId: refund.id,
        idempotencyKey: `REFUND_INITIATED:${refund.id}`,
        payload: { userId: returnRequest.userId, returnId: returnRequestId, refundId: refund.id, amount: `${payment.currency} ${cappedAmount.toFixed(2)}`, ...orderNotificationFields },
      });

      return { refund, isNew: true };
    });

    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'REFUND_CREATED', entityType: 'Refund', entityId: created.refund.id, metadata: { returnRequestId, amount: created.refund.amount.toString(), isNew: created.isNew } });

    if (!created.isNew) {
      // §43 - a losing concurrent caller (or a caller re-hitting an
      // already-in-flight/succeeded attempt) NEVER calls the provider a
      // second time for the same logical refund - it simply returns the
      // current state of the one real attempt already under way.
      return created.refund;
    }

    // The actual provider network call happens OUTSIDE the transaction
    // above (§12's own "never hold a DB transaction open across a payment-
    // provider HTTP call" principle, established in Phase 5) - a lost
    // response here must never leave the transaction that already
    // committed the local Refund row in doubt.
    return this.callProviderAndResolve(created.refund, payment.providerPaymentId);
  }

  private async callProviderAndResolve(refund: Refund, providerPaymentId: string): Promise<Refund> {
    try {
      const providerRefund = await this.provider.createRefund({
        providerPaymentId,
        amountInMinorUnits: toMinorUnits(refund.amount),
        receipt: refund.id,
        notes: { returnRequestId: refund.returnRequestId },
      });
      return this.applyProviderOutcome(refund, providerRefund.id, providerRefund.status);
    } catch (error) {
      return this.reconcileAfterThrownError(refund, providerPaymentId, error);
    }
  }

  /**
   * §24 - the create() call itself threw. Never assumed FAILED: a
   * reconciliation lookup by our own deterministic receipt (the local
   * Refund row's id) is attempted FIRST, exactly like
   * PaymentService.awaitConcurrentProviderOrder's own recovery logic.
   */
  private async reconcileAfterThrownError(refund: Refund, providerPaymentId: string, originalError: unknown): Promise<Refund> {
    try {
      const found = await this.provider.findRefundByReceipt(providerPaymentId, refund.id);
      if (found) {
        // The provider DID create it despite the lost response - resolve
        // to its real status, never silently duplicate by retrying.
        return this.applyProviderOutcome(refund, found.id, found.status);
      }
      // Reconciliation reached the provider and it genuinely has no such
      // refund - a clean, confirmed failure.
      return this.markFailed(refund, originalError instanceof Error ? originalError.message : String(originalError));
    } catch (reconcileError) {
      // Reconciliation itself is unreachable - genuinely UNKNOWN, never
      // guessed as FAILED (§24's own explicit warning).
      this.logger.error(`Refund ${refund.id} outcome is UNKNOWN - provider call failed and reconciliation is also unreachable: ${reconcileError}`);
      return this.markUnknown(refund, originalError instanceof Error ? originalError.message : String(originalError));
    }
  }

  /** §26 - explicit recovery for a refund currently sitting at UNKNOWN. Safe to call any number of times; a still-unreachable provider leaves it UNKNOWN, unchanged. */
  async recover(storeId: string, actor: AuthenticatedUser, refundId: string): Promise<Refund> {
    const refund = await this.prisma.refund.findFirst({ where: { id: refundId, storeId } });
    if (!refund) {
      throw new NotFoundException('Refund not found');
    }
    if (refund.status !== 'UNKNOWN' && refund.status !== 'PROCESSING') {
      return refund; // already resolved - idempotent no-op.
    }

    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
    const found = await this.provider.findRefundByReceipt(payment.providerPaymentId!, refund.id);
    if (!found) {
      return refund; // still cannot be confirmed either way - stays UNKNOWN.
    }

    const resolved = await this.applyProviderOutcome(refund, found.id, found.status);
    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'REFUND_RECOVERED', entityType: 'Refund', entityId: refundId, metadata: { resolvedStatus: resolved.status } });
    return resolved;
  }

  private async applyProviderOutcome(refund: Refund, providerRefundId: string, providerStatus: 'pending' | 'processed' | 'failed'): Promise<Refund> {
    if (providerStatus === 'processed') {
      return this.markSucceeded(refund, providerRefundId);
    }
    if (providerStatus === 'failed') {
      return this.markFailed(refund, 'Provider reported the refund as failed', providerRefundId);
    }
    // 'pending' - the provider accepted it but has not finished processing.
    // Recorded as PROCESSING (a distinct, real, non-terminal state) - never
    // guessed as either success or failure.
    return this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'PROCESSING', providerRefundId } });
  }

  private async markSucceeded(refund: Refund, providerRefundId: string): Promise<Refund> {
    const orderNotificationFields = await this.buildNotificationPayload(refund.orderId, { amount: `${refund.currency} ${refund.amount.toFixed(2)}` });
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refund.updateMany({ where: { id: refund.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } }, data: { status: 'SUCCEEDED', providerRefundId, succeededAt: new Date() } });
      if (result.count === 0) {
        return tx.refund.findUniqueOrThrow({ where: { id: refund.id } }); // already resolved by a concurrent caller - idempotent.
      }

      const returnRequest = await tx.returnRequest.findUniqueOrThrow({ where: { id: refund.returnRequestId }, include: { items: true, order: { include: { items: true } } } });
      const totalReturnedQty = returnRequest.items.reduce((sum, i) => sum + i.quantity, 0);
      const totalOrderedQty = returnRequest.order.items.reduce((sum, i) => sum + i.quantity, 0);
      const wasFullReturn = totalReturnedQty >= totalOrderedQty;

      await tx.returnRequest.updateMany({
        where: { id: refund.returnRequestId, status: 'REFUND_INITIATED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await this.outboxService.record(tx, {
        storeId: refund.storeId,
        eventType: 'REFUND_SUCCEEDED',
        aggregateType: 'Refund',
        aggregateId: refund.id,
        idempotencyKey: `REFUND_SUCCEEDED:${refund.id}`,
        payload: { userId: returnRequest.userId, returnId: refund.returnRequestId, refundId: refund.id, wasFullReturn, ...orderNotificationFields },
      });

      return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    });

    await this.auditLogService.record({ storeId: refund.storeId, action: 'REFUND_SUCCEEDED', entityType: 'Refund', entityId: refund.id, metadata: { providerRefundId, amount: refund.amount.toString() } });
    return updated;
  }

  private async markFailed(refund: Refund, reason: string, providerRefundId?: string): Promise<Refund> {
    this.metrics.incrementCounter('refund_failures_total');
    const orderNotificationFields = await this.buildNotificationPayload(refund.orderId, {});
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refund.updateMany({ where: { id: refund.id, status: { in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } }, data: { status: 'FAILED', failureReason: reason, failedAt: new Date(), providerRefundId } });
      if (result.count > 0) {
        const returnRequest = await tx.returnRequest.findUniqueOrThrow({ where: { id: refund.returnRequestId } });
        await this.outboxService.record(tx, {
          storeId: refund.storeId,
          eventType: 'REFUND_FAILED',
          aggregateType: 'Refund',
          aggregateId: refund.id,
          idempotencyKey: `REFUND_FAILED:${refund.id}`,
          payload: { userId: returnRequest.userId, returnId: refund.returnRequestId, refundId: refund.id, ...orderNotificationFields },
        });
      }
      return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    });

    await this.auditLogService.record({ storeId: refund.storeId, action: 'REFUND_FAILED', entityType: 'Refund', entityId: refund.id, metadata: { reason } });
    return updated;
  }

  private async markUnknown(refund: Refund, reason: string): Promise<Refund> {
    this.metrics.incrementCounter('refund_unknown_total');
    return this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'UNKNOWN', failureReason: reason } });
  }

  async findAllForReturn(storeId: string, returnRequestId: string) {
    return this.prisma.refund.findMany({ where: { storeId, returnRequestId }, orderBy: { createdAt: 'desc' } });
  }
}
