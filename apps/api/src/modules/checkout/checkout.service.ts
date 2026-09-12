import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AppConfig } from '../../config/configuration';
import { CartService } from '../cart/cart.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderService, CreateOrderItemInput } from '../orders/order.service';
import { PaymentService } from '../payments/payment.service';
import { CouponRedemptionService } from '../promotions/coupon-redemption.service';
import { DiscountLine } from '../promotions/discount-engine.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

interface LinePlan extends CreateOrderItemInput {
  inventoryItemId: string;
}

/**
 * Coordinates Cart -> validation -> inventory reservation -> Order creation
 * -> Razorpay order creation (§11/§71). Deliberately thin on its own logic -
 * every piece of real business logic (cart resolution, availability, order
 * numbering, Razorpay calls) is reused from CartService/InventoryService/
 * OrderService/PaymentService, never re-implemented here.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
    private readonly orderService: OrderService,
    private readonly paymentService: PaymentService,
    private readonly couponRedemptionService: CouponRedemptionService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Read-only pre-flight check - reuses CartService's own revalidation pass
   * (which already re-verifies product/variant/price/stock on every read,
   * see the Phase 4 report) rather than duplicating it, and adds only the
   * one thing that's specific to "is this cart ready to become an order".
   */
  async validate(storeId: string, userId: string) {
    const { cartId } = await this.cartService.resolveCart({ storeId, userId });
    const cart = await this.cartService.getCart(cartId);
    const readyForCheckout = cart.items.length > 0 && cart.items.every((item) => item.status === 'VALID');
    return { ...cart, readyForCheckout };
  }

  async createCheckout(storeId: string, userId: string, dto: CreateCheckoutDto, actor: AuthenticatedUser, idempotencyKey?: string) {
    if (idempotencyKey) {
      const payloadHash = this.hashPayload(dto);
      const existing = await this.orderService.findByIdempotencyKey(storeId, userId, idempotencyKey);
      if (existing) {
        if (existing.idempotencyKeyPayloadHash !== payloadHash) {
          throw new ConflictException('This Idempotency-Key was already used with a different checkout request');
        }
        // Same key, same payload - a network-retried request. Recover/reuse
        // the same order's payment attempt rather than creating a second
        // order (§49) - routes through the same recovery-aware method the
        // very first attempt used, so an incomplete provider order from
        // that first attempt is transparently completed here too.
        return this.paymentService.createOrRecoverPaymentSession(
          { id: existing.id, storeId, userId, orderNumber: existing.orderNumber, totalAmount: existing.totalAmount, currency: existing.currency },
          actor,
        );
      }
    }

    const { cartId } = await this.cartService.resolveCart({ storeId, userId });

    const order = await this.prisma.$transaction(async (tx) => {
      // Serializes any two checkout attempts against the SAME cart (a
      // double-click, or a genuine concurrent duplicate request) - the
      // second one only proceeds after the first commits, and by then the
      // cart's items have already been cleared below, so it correctly sees
      // an empty cart and rejects rather than creating a second Order
      // (§61 Test 2).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:cart:${cartId}`}))`;

      const cart = await tx.cart.findUniqueOrThrow({ where: { id: cartId }, include: { items: true } });
      if (cart.items.length === 0) {
        throw new BadRequestException('Your cart is empty');
      }

      const plans: LinePlan[] = [];
      // Phase 7: parallel, index-aligned with `plans` - only what
      // DiscountEngineService needs (never the authoritative order-item
      // data itself, which stays in `plans`/CreateOrderItemInput).
      const discountCandidates: { productId: string; brandId: string | null; lineTotal: Prisma.Decimal }[] = [];
      let subtotal = new Prisma.Decimal(0);

      // Checkout is the final authority (§30/§31) - every line is re-read
      // fresh here, never trusted from the cart's own already-serialized
      // response, even though CartService already validates on read too.
      for (const item of cart.items) {
        const product = await tx.product.findFirst({ where: { id: item.productId, storeId, deletedAt: null } });
        if (!product || product.status !== 'ACTIVE') {
          throw new ConflictException(`A product in your cart is no longer available. Please review your cart.`);
        }

        let authoritativePrice: Prisma.Decimal;
        let variantName: string | null = null;
        let sku: string;
        if (product.productType === 'VARIABLE') {
          const variant = item.variantId
            ? await tx.productVariant.findFirst({
                where: { id: item.variantId, productId: product.id, deletedAt: null },
                include: { attributeValues: { include: { attributeValue: true } } },
              })
            : null;
          if (!variant || variant.status !== 'ACTIVE') {
            throw new ConflictException(`"${product.name}" is no longer available in your selected option. Please review your cart.`);
          }
          authoritativePrice = variant.price;
          sku = variant.sku;
          variantName = variant.attributeValues.map((av) => av.attributeValue.value).join(' / ');
        } else {
          authoritativePrice = product.basePrice;
          sku = product.sku ?? product.slug;
        }

        // Phase 5 correction: release any expired-but-still-ACTIVE
        // reservation for this exact product/variant BEFORE checking
        // availability, so an expired hold nobody has swept yet never
        // wrongly makes real stock look unavailable (§13). Scoped to this
        // line's own candidate inventory items, not a whole-store sweep -
        // cheap, and exactly the rows this availability check is about to read.
        const candidateItemIds = (
          await tx.inventoryItem.findMany({ where: { storeId, productId: product.id, variantId: item.variantId }, select: { id: true } })
        ).map((row) => row.id);
        if (candidateItemIds.length > 0) {
          await this.inventoryService.releaseExpiredReservations(storeId, { inventoryItemIds: candidateItemIds, tx });
        }

        // Single-warehouse allocation only (no split-across-warehouses) - a
        // deliberate simplification consistent with how Phase 3/4 already
        // treat availability as one aggregate figure; see the Phase 5 report.
        const inventoryItem = await tx.inventoryItem.findFirst({
          where: {
            storeId,
            productId: product.id,
            variantId: item.variantId,
            availableQuantity: { gte: item.quantity },
            warehouse: { isActive: true },
          },
          orderBy: { warehouse: { isDefault: 'desc' } },
        });
        if (!inventoryItem) {
          throw new ConflictException(`"${product.name}" no longer has enough available stock. Please review your cart.`);
        }

        const primaryImage = await tx.productImage.findFirst({
          where: { productId: product.id, isPrimary: true, isActive: true },
          select: { url: true },
        });

        const lineTotal = authoritativePrice.times(item.quantity);
        subtotal = subtotal.plus(lineTotal);

        plans.push({
          productId: product.id,
          variantId: item.variantId,
          productNameSnapshot: product.name,
          variantNameSnapshot: variantName,
          skuSnapshot: sku,
          quantity: item.quantity,
          unitPrice: authoritativePrice,
          lineTotal,
          currency: cart.currency,
          imageUrlSnapshot: primaryImage?.url ?? null,
          inventoryItemId: inventoryItem.id,
        });
        discountCandidates.push({ productId: product.id, brandId: product.brandId, lineTotal });
      }

      // Phase 6: shipping price is looked up here, server-side, from the
      // method's OWN row - the client supplies only an id, never an amount
      // (§6/§7). Read inside this same transaction so a shipping method
      // deactivated a moment earlier is re-validated against current state,
      // not a stale pre-check (§34 Race 5). No tax engine or coupons exist
      // yet (see the Phase 5 scope boundary), so total is merchandise
      // subtotal plus this shipping charge only.
      let shippingAmount = new Prisma.Decimal(0);
      let shippingMethodId: string | undefined;
      let shippingMethodNameSnapshot: string | undefined;
      if (dto.shippingMethodId) {
        const method = await tx.shippingMethod.findFirst({
          where: { id: dto.shippingMethodId, storeId, isActive: true, deletedAt: null },
        });
        if (!method) {
          throw new ConflictException('Selected shipping method is not available. Please choose another.');
        }
        shippingAmount = method.price;
        shippingMethodId = method.id;
        shippingMethodNameSnapshot = method.name;
      }

      // Phase 7 §26/§59: coupon is re-evaluated from scratch here, inside
      // this same transaction, never trusting a prior /checkout/coupon/
      // validate preview - a batched category lookup (one query for every
      // line, §66) plus each line's already-loaded brandId gives
      // DiscountEngineService everything it needs with no N+1.
      let discountAmount = new Prisma.Decimal(0);
      let couponEvaluation: Awaited<ReturnType<typeof this.couponRedemptionService.evaluate>> | null = null;
      if (dto.couponCode) {
        const categoryLinks = await tx.productCategory.findMany({
          where: { productId: { in: discountCandidates.map((c) => c.productId) } },
          select: { productId: true, categoryId: true },
        });
        const categoriesByProduct = new Map<string, string[]>();
        for (const link of categoryLinks) {
          const list = categoriesByProduct.get(link.productId) ?? [];
          list.push(link.categoryId);
          categoriesByProduct.set(link.productId, list);
        }
        const discountLines: DiscountLine[] = discountCandidates.map((c) => ({
          productId: c.productId,
          brandId: c.brandId,
          categoryIds: categoriesByProduct.get(c.productId) ?? [],
          lineTotal: c.lineTotal,
        }));

        couponEvaluation = await this.couponRedemptionService.evaluate(tx, {
          storeId,
          userId,
          code: dto.couponCode,
          lines: discountLines,
          subtotal,
        });
        discountAmount = couponEvaluation.discountAmount;
      }

      const totalAmount = subtotal.plus(shippingAmount).minus(discountAmount);
      // §60 - a coupon that would reduce the payable total to zero (or, by
      // construction, below) is rejected outright rather than attempting a
      // zero-amount Razorpay order (not supported by the existing payment
      // flow) or inventing a new zero-payment completion path - see the
      // Phase 7 report for this documented, deliberate scope decision.
      if (totalAmount.lessThanOrEqualTo(0)) {
        throw new ConflictException('This coupon would reduce your order total to zero, which is not supported. Please remove the coupon or add more items to your cart.');
      }
      const shippingAddress = dto.shippingAddress ?? dto.billingAddress;

      const createdOrder = await this.orderService.createWithinTransaction(tx, {
        storeId,
        userId,
        currency: cart.currency,
        subtotal,
        totalAmount,
        customerEmail: dto.email,
        customerPhone: dto.billingAddress.phone,
        billingAddress: dto.billingAddress as unknown as Record<string, unknown>,
        shippingAddress: shippingAddress as unknown as Record<string, unknown>,
        items: plans,
        idempotencyKey,
        idempotencyKeyPayloadHash: idempotencyKey ? this.hashPayload(dto) : undefined,
        shippingAmount,
        shippingMethodId,
        shippingMethodNameSnapshot,
        discountAmount,
        couponId: couponEvaluation?.couponId,
        couponCodeSnapshot: couponEvaluation?.couponCodeSnapshot,
        promotionNameSnapshot: couponEvaluation?.promotionNameSnapshot,
      });

      if (couponEvaluation) {
        await this.couponRedemptionService.createRedemptionRecord(tx, {
          storeId,
          userId,
          orderId: createdOrder.id,
          couponId: couponEvaluation.couponId,
          promotionId: couponEvaluation.promotionId,
          discountAmount: couponEvaluation.discountAmount,
        });
      }

      const reservationTtl = this.configService.get('checkout', { infer: true }).reservationTtlMinutes;
      for (let i = 0; i < createdOrder.items.length; i += 1) {
        const orderItem = createdOrder.items[i];
        const plan = plans[i];
        await this.inventoryService.reserve(
          storeId,
          { inventoryItemId: plan.inventoryItemId, quantity: orderItem.quantity, reference: createdOrder.orderNumber, expiresInMinutes: reservationTtl },
          actor,
          { tx, orderId: createdOrder.id, orderItemId: orderItem.id },
        );
      }

      // The cart's contents have now been converted into permanent
      // OrderItem snapshots - clearing the line items (not the Cart row
      // itself) is both what stops a concurrent duplicate request above
      // from double-processing the same cart, and the correct customer-
      // facing behavior (the cart the customer looks at next should be
      // empty, not still showing items they've already checked out).
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });

      await this.auditLogService.record({
        storeId,
        userId,
        action: 'OrderCreated',
        entityType: 'Order',
        entityId: createdOrder.id,
        metadata: { orderNumber: createdOrder.orderNumber, totalAmount: totalAmount.toFixed(2), itemCount: plans.length },
      });

      return createdOrder;
    }, { timeout: 15_000 });
    // Phase 7: the coupon advisory lock (§32) serializes every concurrent
    // checkout attempt for the SAME coupon - under heavy contention (many
    // customers racing a popular limited coupon) that queuing can
    // legitimately push a late-in-queue attempt's wait time past Prisma's
    // 5s interactive-transaction default before it ever gets to run its own
    // (fast) statements. 15s gives real headroom without masking a genuine
    // hang - it does not change what makes a transaction succeed or fail,
    // only how long a normal, unhurried one is allowed to wait its turn.

    // Phase B - deliberately outside the transaction above (§12): a slow
    // external HTTP call must never hold a Postgres transaction open.
    // createOrRecoverPaymentSession creates this order's first Payment
    // attempt (none exists yet) and durably persists it BEFORE calling
    // Razorpay - see the correction report §3.
    const razorpayInfo = await this.paymentService.createOrRecoverPaymentSession(
      { id: order.id, storeId, userId, orderNumber: order.orderNumber, totalAmount: order.totalAmount, currency: order.currency },
      actor,
    );

    return {
      orderNumber: order.orderNumber,
      razorpayOrderId: razorpayInfo.razorpayOrderId,
      razorpayKeyId: razorpayInfo.razorpayKeyId,
      amount: razorpayInfo.amount,
      currency: razorpayInfo.currency,
      customerEmail: order.customerEmail,
    };
  }

  async retryPayment(storeId: string, userId: string, orderNumber: string, actor: AuthenticatedUser) {
    return this.paymentService.retryPayment(storeId, userId, orderNumber, actor);
  }

  /**
   * Phase 7 §23/§26 - a read-only preview for the "Apply" button: no
   * reservation, no usage-limit enforcement, no database write at all (see
   * CouponRedemptionService.preview's own doc comment on why usage limits
   * are deliberately NOT checked here). The authoritative checkout flow
   * above re-validates everything from scratch regardless, so a preview
   * that goes stale between "Apply" and "Pay Now" can never itself cause an
   * incorrect charge or a bypassed limit.
   */
  async validateCoupon(storeId: string, userId: string, dto: { couponCode: string }) {
    const { cartId } = await this.cartService.resolveCart({ storeId, userId });
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { id: cartId }, include: { items: true } });
    if (cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty');
    }

    const productIds = cart.items.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, storeId, deletedAt: null },
      select: { id: true, brandId: true, basePrice: true },
    });
    const productsById = new Map(products.map((p) => [p.id, p]));

    const variantIds = cart.items.filter((item) => item.variantId).map((item) => item.variantId as string);
    const variants =
      variantIds.length > 0
        ? await this.prisma.productVariant.findMany({ where: { id: { in: variantIds }, deletedAt: null }, select: { id: true, price: true } })
        : [];
    const variantsById = new Map(variants.map((v) => [v.id, v]));

    const categoryLinks = await this.prisma.productCategory.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true, categoryId: true },
    });
    const categoriesByProduct = new Map<string, string[]>();
    for (const link of categoryLinks) {
      const list = categoriesByProduct.get(link.productId) ?? [];
      list.push(link.categoryId);
      categoriesByProduct.set(link.productId, list);
    }

    let subtotal = new Prisma.Decimal(0);
    const lines: DiscountLine[] = [];
    for (const item of cart.items) {
      const product = productsById.get(item.productId);
      if (!product) continue; // an invalid line here is CartService's own concern to surface - this preview simply skips it, exactly as it would contribute nothing to an authoritative checkout that would itself reject it.
      const price = item.variantId ? (variantsById.get(item.variantId)?.price ?? product.basePrice) : product.basePrice;
      const lineTotal = price.times(item.quantity);
      subtotal = subtotal.plus(lineTotal);
      lines.push({ productId: product.id, brandId: product.brandId, categoryIds: categoriesByProduct.get(product.id) ?? [], lineTotal });
    }

    const result = await this.couponRedemptionService.preview(storeId, dto.couponCode, lines, subtotal);
    return {
      couponCode: result.couponCode,
      promotionName: result.promotionName,
      discountType: result.discountType,
      discountAmount: result.discountAmount.toFixed(2),
      subtotal: subtotal.toFixed(2),
    };
  }

  private hashPayload(dto: CreateCheckoutDto): string {
    return createHash('sha256').update(JSON.stringify(dto)).digest('hex');
  }
}
