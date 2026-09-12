import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Prisma, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReservationExpiredException } from '../inventory/exceptions/reservation-expired.exception';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AppConfig } from '../../config/configuration';
import { toMinorUnits } from '../../common/utils/money.util';
import { OrderService } from '../orders/order.service';
import { CouponRedemptionService } from '../promotions/coupon-redemption.service';
import { OutboxService } from '../notifications/outbox.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './providers/payment-provider.interface';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { MetricsService } from '../../common/metrics/metrics.service';
import { SecurityEventsService } from '../../common/security/security-events.service';

const ACTIVE_PAYMENT_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING', 'AUTHORIZED'];

interface OrderRef {
  id: string;
  storeId: string;
  userId: string;
  orderNumber: string;
  totalAmount: Prisma.Decimal;
  currency: string;
}

/** Only ever used for a system-initiated action with no real HTTP actor (a webhook, or a rollback after Razorpay itself failed) - never a stand-in for a genuine customer request. */
function systemActor(userId: string): AuthenticatedUser {
  return { userId, storeId: '', email: '', type: 'CUSTOMER', roles: [], permissions: [] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Final micro-correction (§13): bounds how long a concurrent recovery
 * request waits on the ONE request that actually claimed the right to call
 * Razorpay's createOrder() for a given Payment attempt, before falling back
 * to a read-only reconciliation check of its own. Real Razorpay create-order
 * calls typically resolve in well under a second: 30 x 40ms = 1.2s is a
 * generous local wait for that, without letting a genuinely stuck claimant
 * hold up every other concurrent caller indefinitely.
 */
const CONCURRENT_CLAIM_POLL_ATTEMPTS = 30;
const CONCURRENT_CLAIM_POLL_INTERVAL_MS = 40;

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
    private readonly couponRedemptionService: CouponRedemptionService,
    private readonly outboxService: OutboxService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly metrics: MetricsService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  /**
   * Only non-sensitive, already order-visible fields (§28) - never a
   * payment secret/token. Deliberately reads via `this.prisma` (never a
   * `tx`) and is always called BEFORE opening the transaction it feeds
   * into: every field read here (orderNumber/currency/customerEmail/
   * billingAddress/shippingMethodNameSnapshot) is an immutable snapshot,
   * frozen at order creation and never mutated afterward (see Order's own
   * schema doc comments), so reading it slightly outside strict
   * transactional isolation is safe. This was a real defect found and
   * fixed during this phase's own audit: the first version read this
   * INSIDE finalizeReservationsAndConfirmOrder's transaction, adding an
   * avoidable extra round-trip to a transaction that already loops over
   * every order line's reservation - under load that pushed it past
   * Prisma's default 5s interactive-transaction timeout and produced a
   * hard "transaction not found" failure. Notifications must never be able
   * to destabilize the payment/order transaction they observe (§30/§33).
   */
  private async buildOrderNotificationPayload(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, userId: true, orderNumber: true, totalAmount: true, currency: true, customerEmail: true, billingAddress: true, shippingMethodNameSnapshot: true },
    });
    const billing = order.billingAddress as { fullName?: string } | null;
    return {
      userId: order.userId,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderTotal: `${order.currency} ${Number(order.totalAmount).toFixed(2)}`,
      customerName: billing?.fullName ?? order.customerEmail,
      shippingMethod: order.shippingMethodNameSnapshot ?? '',
    };
  }

  get publicKeyId(): string {
    return this.provider.publicKeyId;
  }

  /**
   * Correction pass - replaces the old createRazorpayOrderForOrder(). Entry
   * point for Phase B of checkout AND for both recovery and genuine retry,
   * unified in one place so "reuse the existing attempt" vs "start a new
   * one" is decided exactly once, consistently (see the correction report
   * §3/§6): a non-terminal existing Payment (CREATED/PENDING/AUTHORIZED) is
   * always completed/recovered, never duplicated; a new Payment row is only
   * ever created when none exists yet or the latest one already reached a
   * terminal FAILED/CANCELLED state.
   */
  async createOrRecoverPaymentSession(order: OrderRef, actor: AuthenticatedUser) {
    const { payment, created } = await this.prisma.$transaction(async (tx) => {
      // Final micro-correction (§12/§13): serializes concurrent recovery/
      // retry attempts for the SAME order so that at most one of them ever
      // creates a brand-new Payment row when the latest existing one has
      // already reached a terminal FAILED/CANCELLED state - without this,
      // two simultaneous retry-payment calls could each independently see
      // "no reusable attempt" and each create their own new Payment. This is
      // a fast, HTTP-free critical section only - it is released the instant
      // this callback returns, well before any Razorpay network call (§5).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment:order:${order.id}`}))`;

      const latest = await tx.payment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
      if (latest && ACTIVE_PAYMENT_STATUSES.includes(latest.status)) {
        return { payment: latest, created: false };
      }

      const createdPayment = await tx.payment.create({
        data: { storeId: order.storeId, orderId: order.id, provider: 'RAZORPAY', providerOrderId: null, amount: order.totalAmount, currency: order.currency, status: 'CREATED' },
      });
      return { payment: createdPayment, created: true };
    });

    if (created) {
      await this.auditLogService.record({
        storeId: order.storeId,
        userId: order.userId,
        action: 'PaymentAttemptCreated',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { orderId: order.id },
      });
    }

    return this.ensureProviderOrder(order, payment, actor);
  }

  /**
   * Guarantees `payment.providerOrderId` is populated, without ever holding
   * a DB transaction open across the Razorpay HTTP call (§12). `receipt` is
   * the local Payment row's own id - deterministic and unique per attempt,
   * so a lost create-response can always be reconciled back to this exact
   * attempt (never a different one, never a duplicate) via
   * PaymentProvider.fetchOrderByReceipt.
   */
  private async ensureProviderOrder(
    order: OrderRef,
    payment: { id: string; providerOrderId: string | null; amount: Prisma.Decimal; currency: string },
    actor: AuthenticatedUser,
  ) {
    if (payment.providerOrderId) {
      // Already fully persisted from an earlier call (or just recovered by
      // one) - idempotent, no new provider call at all.
      return this.toSession(order, payment as { providerOrderId: string; amount: Prisma.Decimal; currency: string });
    }

    const receipt = payment.id;

    // Final micro-correction (§13): createOrder() must never be called
    // twice for the SAME Payment attempt - two concurrent recovery requests
    // could otherwise both observe providerOrderId === null and both reach
    // Razorpay before either persists a result. This atomic conditional
    // update lets AT MOST ONE concurrent caller "claim" the right to call
    // it; CREATED -> PENDING is otherwise unused anywhere in this codebase
    // (see ACTIVE_PAYMENT_STATUSES above) and is reused here purely as a
    // local claim marker, needing no new schema/state (§ prompt guidance to
    // prefer existing states). Every other concurrent caller safely waits
    // for the claimant's outcome instead of racing it.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'CREATED', providerOrderId: null },
      data: { status: 'PENDING' },
    });
    if (claimed.count === 0) {
      return this.awaitConcurrentProviderOrder(order, payment.id, receipt);
    }

    try {
      const providerOrder = await this.provider.createOrder({
        amountInMinorUnits: toMinorUnits(payment.amount),
        currency: payment.currency,
        receipt,
        notes: { orderId: order.id, orderNumber: order.orderNumber, paymentId: payment.id },
      });
      const updated = await this.prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: providerOrder.id } });
      await this.auditLogService.record({
        storeId: order.storeId,
        userId: order.userId,
        action: 'PaymentCreated',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { orderId: order.id, providerOrderId: providerOrder.id },
      });
      return this.toSession(order, { ...updated, providerOrderId: providerOrder.id });
    } catch {
      // The create call failed from OUR side's point of view, but that does
      // not mean Razorpay never processed it - reconcile before concluding
      // anything (§5). Recovery must never blindly create a second remote
      // order for the same attempt (§6).
      let reconciled;
      try {
        reconciled = await this.provider.fetchOrderByReceipt(receipt);
      } catch {
        // Can't even check right now - genuinely unknown. Not safe to
        // cancel (the remote order may already exist, or may still appear
        // in a moment) - leave the Payment row exactly as-is (CREATED,
        // providerOrderId still null) so the very next retry safely
        // re-attempts this same reconciliation, and tell the customer
        // honestly rather than claiming a failure we haven't confirmed (§11).
        throw new ServiceUnavailableException({
          statusCode: 503,
          message: 'Payment setup is being verified. Please retry in a moment.',
          retryable: true,
        });
      }

      if (reconciled) {
        const updated = await this.prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: reconciled.id } });
        await this.auditLogService.record({
          storeId: order.storeId,
          userId: order.userId,
          action: 'PaymentRecovered',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { orderId: order.id, providerOrderId: reconciled.id },
        });
        return this.toSession(order, { ...updated, providerOrderId: reconciled.id });
      }

      // Reconciliation itself succeeded and positively confirmed: no such
      // order exists on the provider's side. Genuinely never created - safe
      // to conclude failure now, exactly as before this correction (§7 Case A).
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: ACTIVE_PAYMENT_STATUSES } },
        data: { status: 'FAILED', failureReason: 'Provider order creation failed' },
      });
      await this.releaseReservationsAndCancelOrder(order.storeId, order.id, order.userId);
      throw new ServiceUnavailableException('Payment initialization failed. Please try again.');
    }
  }

  /**
   * The path taken by every concurrent caller that lost the claim above
   * (§13/§14). Never calls createOrder() itself - only the claimant may do
   * that - so no number of concurrent losers can ever produce a second
   * remote order. Polls the local Payment row (cheap, no network call) for
   * the claimant's outcome; if the claimant is still in flight after a
   * bounded wait, falls back to the same read-only fetchOrderByReceipt()
   * reconciliation a lost-response recovery uses (safe for any number of
   * concurrent callers, unlike createOrder()) before giving the customer the
   * same honest soft-uncertain response (§11).
   */
  private async awaitConcurrentProviderOrder(order: OrderRef, paymentId: string, receipt: string) {
    for (let attempt = 0; attempt < CONCURRENT_CLAIM_POLL_ATTEMPTS; attempt += 1) {
      const current = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.providerOrderId) {
        return this.toSession(order, { providerOrderId: current.providerOrderId, amount: current.amount, currency: current.currency });
      }
      if (!ACTIVE_PAYMENT_STATUSES.includes(current.status)) {
        // The claimant already reached a terminal state (FAILED/CANCELLED)
        // without ever producing a provider order - it has already run its
        // own genuine-failure handling (reservation release + order
        // cancel). Nothing left here to wait for.
        throw new ServiceUnavailableException('Payment initialization failed. Please try again.');
      }
      await sleep(CONCURRENT_CLAIM_POLL_INTERVAL_MS);
    }

    const reconciled = await this.provider.fetchOrderByReceipt(receipt).catch(() => null);
    if (reconciled) {
      const updated = await this.prisma.payment.update({ where: { id: paymentId }, data: { providerOrderId: reconciled.id } });
      return this.toSession(order, { ...updated, providerOrderId: reconciled.id });
    }

    throw new ServiceUnavailableException({
      statusCode: 503,
      message: 'Payment setup is being verified. Please retry in a moment.',
      retryable: true,
    });
  }

  private toSession(order: OrderRef, payment: { providerOrderId: string; amount: Prisma.Decimal; currency: string }) {
    return {
      orderNumber: order.orderNumber,
      razorpayOrderId: payment.providerOrderId,
      razorpayKeyId: this.provider.publicKeyId,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
    };
  }

  /**
   * §29 payment retry: a genuine customer-initiated retry only ever reaches
   * createOrRecoverPaymentSession() through here, and that method itself is
   * what decides "reuse the existing non-terminal attempt" vs "the last one
   * already FAILED/CANCELLED, start a new one" - see its own doc comment.
   * Never recalculates price (§81 order immutability).
   */
  async retryPayment(storeId: string, userId: string, orderNumber: string, actor: AuthenticatedUser) {
    const order = await this.orderService.getScopedOrderOrThrow(storeId, userId, orderNumber);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(`Cannot retry payment for an order with status ${order.status}`);
    }

    const reservationTtl = this.configService.get('checkout', { infer: true }).reservationTtlMinutes;

    for (const item of order.items) {
      if (!item.productId) continue; // product was deleted after the order was placed - nothing to re-reserve against.

      // Release any expired-but-still-ACTIVE hold for this exact line
      // BEFORE checking what's still valid, so a stale reservation nobody
      // has swept yet never wrongly blocks re-reservation (§13).
      const candidateItemIds = (
        await this.prisma.inventoryItem.findMany({ where: { storeId, productId: item.productId, variantId: item.variantId }, select: { id: true } })
      ).map((row) => row.id);
      if (candidateItemIds.length > 0) {
        await this.inventoryService.releaseExpiredReservations(storeId, { inventoryItemIds: candidateItemIds });
      }

      const reservations = await this.inventoryService.findReservationsForOrder(storeId, order.id);
      const existing = reservations.find((r) => r.orderItemId === item.id);
      if (existing?.status === 'ACTIVE') continue; // already swept above if it were expired - a remaining ACTIVE row is genuinely still valid.

      const inventoryItem = await this.prisma.inventoryItem.findFirst({
        where: { storeId, productId: item.productId, variantId: item.variantId, availableQuantity: { gte: item.quantity } },
        include: { warehouse: true },
        orderBy: { warehouse: { isDefault: 'desc' } },
      });
      if (!inventoryItem) {
        throw new ConflictException(`"${item.productNameSnapshot}" no longer has enough available stock to retry this order`);
      }

      await this.inventoryService.reserve(
        storeId,
        { inventoryItemId: inventoryItem.id, quantity: item.quantity, reference: order.orderNumber, expiresInMinutes: reservationTtl },
        actor,
        { orderId: order.id, orderItemId: item.id },
      );
    }

    return this.createOrRecoverPaymentSession(order, actor);
  }

  async verifyPayment(storeId: string, userId: string, dto: VerifyPaymentDto, actor: AuthenticatedUser) {
    const order = await this.orderService.getScopedOrderOrThrow(storeId, userId, dto.orderNumber);
    const payment = order.payments.find((p) => p.providerOrderId === dto.razorpayOrderId);
    if (!payment) {
      // Either a typo'd/tampered razorpayOrderId, or one that genuinely
      // belongs to a DIFFERENT order - both get the same safe 404 (§24).
      throw new NotFoundException('Payment not found for this order');
    }

    if (payment.status === 'CAPTURED') {
      return this.orderService.toSafeDetail(await this.orderService.getByIdOrThrow(order.id));
    }
    if (!ACTIVE_PAYMENT_STATUSES.includes(payment.status)) {
      throw new ConflictException('This payment attempt is no longer valid - please retry');
    }

    const signatureValid = this.provider.verifyPaymentSignature({
      orderId: dto.razorpayOrderId,
      paymentId: dto.razorpayPaymentId,
      signature: dto.razorpaySignature,
    });
    if (!signatureValid) {
      await this.markFailed(payment.id, 'Signature verification failed', order.storeId);
      throw new BadRequestException('Payment could not be verified. Please retry.');
    }

    const providerPayment = await this.provider.fetchPayment(dto.razorpayPaymentId);

    // Signature validity alone is not enough - the payment must genuinely
    // belong to THIS order, for THIS amount, in THIS currency (§24).
    const identityMatches =
      providerPayment.order_id === dto.razorpayOrderId &&
      providerPayment.amount === toMinorUnits(payment.amount) &&
      providerPayment.currency === payment.currency;
    if (!identityMatches) {
      await this.markFailed(payment.id, 'Payment identity mismatch', order.storeId);
      throw new BadRequestException('Payment could not be verified. Please retry.');
    }

    if (providerPayment.status !== 'captured') {
      await this.markFailed(payment.id, `Provider reported status: ${providerPayment.status}`, order.storeId);
      throw new BadRequestException('Payment was not completed successfully.');
    }

    await this.applySuccessfulPayment(order.storeId, order.id, payment.id, dto.razorpayPaymentId, order.userId);
    return this.orderService.toSafeDetail(await this.orderService.getByIdOrThrow(order.id));
  }

  /**
   * Trusted-provider-event path (§39) - converges on the exact same
   * `applySuccessfulPayment`/`markFailed` transitions the client-callback
   * path (`verifyPayment`) uses, so the two can never disagree about the
   * final state. Idempotent: a byte-identical redelivery is detected via
   * the (provider, eventId) uniqueness ledger before anything else runs.
   */
  async processWebhook(rawBody: string, signature: string | undefined): Promise<{ received: boolean }> {
    if (!signature || !this.provider.verifyWebhookSignature(rawBody, signature)) {
      this.metrics.incrementCounter('webhook_failures_total', { provider: 'razorpay', reason: 'invalid_signature' });
      this.securityEvents.emit('WEBHOOK_SIGNATURE_INVALID', { provider: 'razorpay' });
      throw new BadRequestException('Invalid webhook signature');
    }

    let body: { id?: string; event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string } } } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Malformed webhook payload');
    }

    const eventType = body.event ?? 'unknown';
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    // Razorpay's own event id when present, else the payload's own hash -
    // either way, a true duplicate delivery always produces the same key.
    const eventId = body.id ?? payloadHash;

    const alreadyProcessed = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: 'RAZORPAY', eventId } },
    });
    if (alreadyProcessed) {
      return { received: true };
    }

    const paymentEntity = body.payload?.payment?.entity;
    if (eventType === 'payment.captured' && paymentEntity?.order_id && paymentEntity.id) {
      await this.handlePaymentCapturedWebhook(paymentEntity as { id: string; order_id: string; amount: number; currency: string });
    } else if (eventType === 'payment.failed' && paymentEntity?.order_id) {
      await this.handlePaymentFailedWebhook(paymentEntity.order_id, paymentEntity.id ?? null);
    }
    // Any other event type is simply acknowledged (recorded for idempotency,
    // no state change) - Razorpay may add new event types over time, and an
    // unrecognized-but-validly-signed event is never an error.

    try {
      await this.prisma.paymentWebhookEvent.create({
        data: { provider: 'RAZORPAY', eventId, eventType, payloadHash, processedAt: new Date() },
      });
    } catch {
      // Lost a race with a concurrent delivery of the exact same event - the
      // other one already recorded it, and (being the same event) already
      // applied the same effect. Still a safe, correct no-op either way.
    }

    return { received: true };
  }

  private async handlePaymentCapturedWebhook(payment: { id: string; order_id: string; amount: number; currency: string }): Promise<void> {
    const localPayment = await this.prisma.payment.findUnique({ where: { provider_providerOrderId: { provider: 'RAZORPAY', providerOrderId: payment.order_id } } });
    if (!localPayment) return; // an order id we don't recognize at all - nothing to do.
    if (localPayment.status === 'CAPTURED') return; // already applied (e.g. the client callback got there first).

    if (localPayment.amount.toNumber() * 100 !== payment.amount || localPayment.currency !== payment.currency) {
      await this.markFailed(localPayment.id, 'Webhook amount/currency mismatch', localPayment.storeId);
      return;
    }

    const order = await this.orderService.getByIdOrThrow(localPayment.orderId);
    await this.applySuccessfulPayment(order.storeId, order.id, localPayment.id, payment.id, order.userId);
  }

  private async handlePaymentFailedWebhook(providerOrderId: string, providerPaymentId: string | null): Promise<void> {
    const localPayment = await this.prisma.payment.findUnique({ where: { provider_providerOrderId: { provider: 'RAZORPAY', providerOrderId } } });
    if (!localPayment || localPayment.status === 'CAPTURED') return;
    await this.markFailed(localPayment.id, `Razorpay reported payment failure${providerPaymentId ? ` (${providerPaymentId})` : ''}`, localPayment.storeId);
  }

  /**
   * Payment capture is recorded first and independently (§7): real money
   * moved, and that fact must never be lost or rolled back regardless of
   * what happens to inventory next. Reservation finalization is then
   * delegated to finalizeReservationsAndConfirmOrder(), which runs on EVERY
   * call - whether this call is the one that just captured the payment, or
   * a later idempotent replay (repeat verify, webhook redelivery) of a
   * payment that was captured earlier but whose finalization did not yet
   * complete. That replay-safety is precisely the deterministic recovery
   * path required by the final micro-correction (§3): a captured payment is
   * never permanently orphaned from a chance to finalize, and repeating the
   * call is always safe (§11) because finalizeReservationsAndConfirmOrder
   * itself is a strict, idempotent no-op the moment the order is no longer
   * PENDING_PAYMENT.
   */
  private async applySuccessfulPayment(storeId: string, orderId: string, paymentId: string, providerPaymentId: string, orderUserId: string): Promise<void> {
    // Atomic conditional transition - a duplicate concurrent call (client
    // callback racing the webhook) only ever applies this exactly once;
    // the loser sees count===0 and moves straight to finalization below,
    // which is itself just as safe to run twice (§28/§39). The OutboxEvent
    // is created in the SAME transaction as the status flip (Phase 9 §14/
    // §30/§17) - only the winner of the conditional update ever reaches it,
    // so a webhook/client-callback race can never emit PAYMENT_SUCCESS twice.
    const notificationPayload = await this.buildOrderNotificationPayload(orderId);
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ACTIVE_PAYMENT_STATUSES } },
        data: { status: 'CAPTURED', providerPaymentId, paidAt: new Date() },
      });
      if (result.count > 0) {
        await this.outboxService.record(tx, {
          storeId,
          eventType: 'PAYMENT_SUCCESS',
          aggregateType: 'Payment',
          aggregateId: paymentId,
          idempotencyKey: `PAYMENT_SUCCESS:${paymentId}`,
          payload: notificationPayload,
        });
      }
      return result;
    });
    if (transitioned.count > 0) {
      await this.auditLogService.record({ storeId, userId: orderUserId, action: 'PaymentCaptured', entityType: 'Payment', entityId: paymentId, metadata: { orderId } });
    }

    await this.finalizeReservationsAndConfirmOrder(storeId, orderId, orderUserId, paymentId);
  }

  /**
   * Final micro-correction - Issue A. Commits every order line's CURRENT
   * reservation and confirms the Order as ONE all-or-nothing local
   * transaction (§8/§9): either every required line becomes COMMITTED and
   * the Order becomes CONFIRMED together, or NONE of them change at all.
   * The previous design consumed each reservation as an independent
   * operation, which could leave line A COMMITTED while line B's hold had
   * expired and the Order stayed unconfirmed - a captured payment then had
   * no deterministic path back to a fully consistent state. Sharing one
   * transaction for every line closes that: InventoryService.consume()'s
   * own atomic expiry check (§18 of the prior correction) still decides the
   * payment-vs-expiry race for each line, but now a SINGLE expired line
   * aborts the whole attempt instead of only itself.
   *
   * Idempotent and safe to call any number of times for the same order
   * (repeat verify, webhook redelivery, or a future background retry): it
   * first checks the Order's OWN current status, so once it has succeeded
   * once, every later call is a fast no-op.
   */
  private async finalizeReservationsAndConfirmOrder(storeId: string, orderId: string, orderUserId: string, paymentId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order || order.status !== 'PENDING_PAYMENT') return; // already confirmed/cancelled - fully idempotent no-op.

    const reservations = await this.prisma.stockReservation.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });

    // Only the MOST RECENT reservation per order line is currently relevant.
    // retryPayment() may have superseded an earlier expired/released hold
    // for a line with a fresh one (tagged with the same orderId/
    // orderItemId) - an older, already-superseded row must never be
    // mistaken for "this line can no longer be fulfilled."
    const latestPerLine = new Map<string, (typeof reservations)[number]>();
    for (const reservation of reservations) {
      if (!reservation.orderItemId) continue;
      if (!latestPerLine.has(reservation.orderItemId)) {
        latestPerLine.set(reservation.orderItemId, reservation);
      }
    }
    const currentReservations = [...latestPerLine.values()];

    if (currentReservations.some((r) => r.status === 'RELEASED')) {
      // At least one order line's CURRENT reservation has already lapsed
      // (and been safely released) with no fresher hold behind it - this
      // Order can never be fully committed via this attempt (§8/§9). This
      // was already flagged for reconciliation the moment it first
      // happened (see the catch branch below) - nothing further to retry.
      return;
    }

    const actor = systemActor(orderUserId);
    // Fetched BEFORE opening the transaction below (§30 doc comment on
    // buildOrderNotificationPayload) - this transaction already loops over
    // every order line's reservation and must not carry any avoidable extra
    // latency that could push it past Prisma's interactive-transaction
    // timeout under load.
    const notificationPayload = await this.buildOrderNotificationPayload(orderId);
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const reservation of currentReservations) {
          if (reservation.status === 'COMMITTED') continue; // already done by an earlier successful attempt - consume() is itself idempotent on this too.
          await this.inventoryService.consume(storeId, reservation.id, actor, tx);
        }
        // Phase 7 §36: RESERVED -> CONSUMED, in the SAME transaction as the
        // reservation commit and order confirmation - if any line's
        // reservation had expired (caught below), this rolls back together
        // with everything else, leaving the coupon redemption exactly
        // RESERVED, not permanently consumed for an order that wasn't
        // actually confirmed. A no-op if this order has no coupon at all,
        // and idempotent under a client-verify/webhook race (see
        // CouponRedemptionService.consume's own doc comment).
        await this.couponRedemptionService.consume(tx, orderId);
        await this.orderService.confirm(tx, orderId);
        await this.outboxService.record(tx, {
          storeId,
          eventType: 'ORDER_CONFIRMED',
          aggregateType: 'Order',
          aggregateId: orderId,
          idempotencyKey: `ORDER_CONFIRMED:${orderId}`,
          payload: notificationPayload,
        });
      });
      await this.auditLogService.record({ storeId, userId: orderUserId, action: 'OrderConfirmed', entityType: 'Order', entityId: orderId });
    } catch (error) {
      if (!(error instanceof ReservationExpiredException)) throw error;

      // All-or-nothing (§8/§9): the transaction above rolled back in full -
      // no line was left COMMITTED while a sibling line sat expired; every
      // reservation is exactly where it was before this attempt. Only NOW,
      // outside that rolled-back transaction, release whichever
      // reservation(s) genuinely lapsed - reusing the same atomic
      // conditional release the background sweep uses, so this is safe
      // against a concurrent sweep or another finalization retry.
      await this.inventoryService.releaseExpiredReservations(storeId, { orderId });

      // Do NOT silently confirm an order without the inventory behind it,
      // and do NOT silently discard a real captured payment (§10). The
      // payment stays CAPTURED - already durably recorded - and the order
      // stays PENDING_PAYMENT: a deterministic, honestly-recorded state
      // pending manual reconciliation, a future phase's concern (no refund/
      // partial-fulfillment automation exists, nor should this correction
      // invent one).
      await this.auditLogService.record({
        storeId,
        userId: orderUserId,
        action: 'PaymentCapturedReservationExpired',
        entityType: 'Order',
        entityId: orderId,
        metadata: {
          paymentId,
          reason:
            'One or more inventory reservations expired before payment could be confirmed - all reservations for this order were left unchanged (all-or-nothing) and the expired one(s) have now been safely released. Requires manual reconciliation.',
        },
      });
    }
  }

  private async markFailed(paymentId: string, reason: string, storeId?: string): Promise<void> {
    this.metrics.incrementCounter('payment_failures_total');
    // Payment lookup + payload build happen BEFORE opening the transaction
    // below (§30 doc comment on buildOrderNotificationPayload) - only the
    // atomic conditional update + outbox insert run inside it.
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const effectiveStoreId = storeId ?? payment.storeId;
    const notificationPayload = await this.buildOrderNotificationPayload(payment.orderId);

    // Payment status flip + PAYMENT_FAILED outbox event share ONE
    // transaction (§14/§30) - only the caller that actually wins the
    // conditional update ever emits the event, so a webhook/client race
    // over the same already-terminal attempt can never double-notify.
    const resolvedStoreId = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ACTIVE_PAYMENT_STATUSES } },
        data: { status: 'FAILED', failureReason: reason },
      });
      if (result.count > 0) {
        await this.outboxService.record(tx, {
          storeId: effectiveStoreId,
          eventType: 'PAYMENT_FAILED',
          aggregateType: 'Payment',
          aggregateId: paymentId,
          idempotencyKey: `PAYMENT_FAILED:${paymentId}`,
          payload: notificationPayload,
        });
      }
      return effectiveStoreId;
    });
    await this.auditLogService.record({
      storeId: resolvedStoreId,
      action: 'PaymentFailed',
      entityType: 'Payment',
      entityId: paymentId,
      metadata: { reason },
    });
  }

  private async releaseReservationsAndCancelOrder(storeId: string, orderId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservations = await tx.stockReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
      for (const reservation of reservations) {
        await this.inventoryService.release(storeId, reservation.id, systemActor(userId), tx);
      }
      const result = await this.orderService.cancel(tx, orderId);
      // Phase 7 §37: this path only ever fires BEFORE any successful
      // payment, so a redemption here can only ever be RESERVED (never
      // CONSUMED) - release() is a safe no-op either way.
      await this.couponRedemptionService.release(tx, orderId);
      // Phase 6: only write a history row if the order was genuinely
      // PENDING_PAYMENT and this call is what actually cancelled it -
      // never record a transition that didn't happen (e.g. a concurrent
      // caller already moved the order to some other state first).
      if (result.count > 0) {
        await tx.orderStatusHistory.create({
          data: {
            storeId,
            orderId,
            previousStatus: 'PENDING_PAYMENT',
            newStatus: 'CANCELLED',
            changedByUserId: userId,
            source: 'SYSTEM',
            reason: 'Payment provider order creation failed',
          },
        });
      }
    });
    await this.auditLogService.record({ storeId, userId, action: 'ReservationReleased', entityType: 'Order', entityId: orderId, metadata: { reason: 'Payment provider order creation failed' } });
  }
}
