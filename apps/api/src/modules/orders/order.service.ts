import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { generateOrderNumber } from './utils/order-number.util';
import { QueryAdminOrdersDto } from './dto/query-admin-orders.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';
const MAX_ORDER_NUMBER_ATTEMPTS = 5;

export interface CreateOrderItemInput {
  productId: string | null;
  variantId: string | null;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
  quantity: number;
  unitPrice: Prisma.Decimal | string;
  lineTotal: Prisma.Decimal | string;
  currency: string;
  imageUrlSnapshot: string | null;
}

export interface CreateOrderInput {
  storeId: string;
  userId: string;
  currency: string;
  subtotal: Prisma.Decimal | string;
  totalAmount: Prisma.Decimal | string;
  customerEmail: string;
  customerPhone: string | null;
  billingAddress: Record<string, unknown>;
  shippingAddress: Record<string, unknown>;
  items: CreateOrderItemInput[];
  idempotencyKey?: string;
  idempotencyKeyPayloadHash?: string;
  // Phase 6 - all optional so every pre-Phase-6 call site (and every
  // existing test) that never mentions shipping continues to create an
  // Order with shippingAmount 0 / no shipping method, exactly as before.
  shippingAmount?: Prisma.Decimal | string;
  shippingMethodId?: string;
  shippingMethodNameSnapshot?: string;
  // Phase 7 - all optional, same rationale: every pre-Phase-7 call site
  // continues to create an Order with discountAmount 0 / no coupon.
  discountAmount?: Prisma.Decimal | string;
  couponId?: string;
  couponCodeSnapshot?: string;
  promotionNameSnapshot?: string;
}

const ORDER_DETAIL_INCLUDE = {
  items: true,
  payments: { orderBy: { createdAt: 'desc' as const } },
  shippingMethod: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

const ADMIN_ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  currency: true,
  totalAmount: true,
  customerEmail: true,
  createdAt: true,
  shippingMethod: { select: { name: true } },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { status: true } },
} satisfies Prisma.OrderSelect;

type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

/**
 * Order creation, retrieval, and the two status transitions checkout/payment
 * ever make (see the OrderStatus enum's own doc comment in schema.prisma).
 * Never called with a client-supplied status - PENDING_PAYMENT is the only
 * status an Order is ever created with; CONFIRMED/CANCELLED only ever come
 * from PaymentService after real payment verification (see §16/§82).
 */
@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  /** Must be called with a transaction client already holding the reservation writes for the same checkout attempt. */
  async createWithinTransaction(tx: Prisma.TransactionClient, input: CreateOrderInput) {
    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      const orderNumber = generateOrderNumber();
      try {
        return await tx.order.create({
          data: {
            storeId: input.storeId,
            userId: input.userId,
            orderNumber,
            status: 'PENDING_PAYMENT',
            currency: input.currency,
            subtotal: input.subtotal,
            totalAmount: input.totalAmount,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            billingAddress: input.billingAddress as Prisma.InputJsonValue,
            shippingAddress: input.shippingAddress as Prisma.InputJsonValue,
            idempotencyKey: input.idempotencyKey,
            idempotencyKeyPayloadHash: input.idempotencyKeyPayloadHash,
            shippingAmount: input.shippingAmount ?? 0,
            shippingMethodId: input.shippingMethodId,
            shippingMethodNameSnapshot: input.shippingMethodNameSnapshot,
            discountAmount: input.discountAmount ?? 0,
            couponId: input.couponId,
            couponCodeSnapshot: input.couponCodeSnapshot,
            promotionNameSnapshot: input.promotionNameSnapshot,
            items: {
              create: input.items.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                productNameSnapshot: item.productNameSnapshot,
                variantNameSnapshot: item.variantNameSnapshot,
                skuSnapshot: item.skuSnapshot,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                lineTotal: item.lineTotal,
                currency: item.currency,
                imageUrlSnapshot: item.imageUrlSnapshot,
              })),
            },
          },
          include: { items: true },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error) && attempt < MAX_ORDER_NUMBER_ATTEMPTS - 1) {
          continue; // orderNumber collision (astronomically unlikely) - retry with a fresh random suffix.
        }
        throw error;
      }
    }
    throw new ConflictException('Could not generate a unique order number - please try again');
  }

  async confirm(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    // Atomic conditional transition - a duplicate webhook/verify call racing
    // this one only ever flips PENDING_PAYMENT -> CONFIRMED exactly once;
    // the loser sees count===0 and is a safe no-op (see PaymentService).
    await tx.order.updateMany({ where: { id: orderId, status: 'PENDING_PAYMENT' }, data: { status: 'CONFIRMED' } });
  }

  async cancel(tx: Prisma.TransactionClient, orderId: string): Promise<Prisma.BatchPayload> {
    return tx.order.updateMany({ where: { id: orderId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
  }

  async findForCustomer(storeId: string, userId: string, query: PaginationQueryDto) {
    const where = { storeId, userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, orderNumber: true, status: true, currency: true, totalAmount: true, createdAt: true },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(
      items.map((o) => ({ ...o, totalAmount: o.totalAmount.toFixed(2) })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOneForCustomer(storeId: string, userId: string, orderNumber: string) {
    return this.toSafeDetail(await this.getScopedOrderOrThrow(storeId, userId, orderNumber));
  }

  async getScopedOrderOrThrow(storeId: string, userId: string, orderNumber: string): Promise<OrderDetailRow> {
    const order = await this.prisma.order.findFirst({
      where: { storeId, userId, orderNumber },
      include: ORDER_DETAIL_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async findByIdempotencyKey(storeId: string, userId: string, idempotencyKey: string): Promise<OrderDetailRow | null> {
    return this.prisma.order.findFirst({ where: { storeId, userId, idempotencyKey }, include: ORDER_DETAIL_INCLUDE });
  }

  async getByIdOrThrow(orderId: string): Promise<OrderDetailRow> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  // -----------------------------------------------------------------------
  // Admin (Phase 6) - no userId scoping: an admin may see any order that
  // belongs to their OWN store, never another store's (tenant isolation is
  // still storeId-scoped exactly like every customer-facing method above).
  // -----------------------------------------------------------------------

  async findAllForAdmin(storeId: string, query: QueryAdminOrdersDto) {
    const where: Prisma.OrderWhereInput = {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentStatus ? { payments: { some: { status: query.paymentStatus } } } : {}),
      ...(query.dateFrom || query.dateTo
        ? { createdAt: { ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}), ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}) } }
        : {}),
      ...(query.search
        ? { OR: [{ orderNumber: { contains: query.search, mode: 'insensitive' } }, { customerEmail: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: ADMIN_ORDER_LIST_SELECT,
        orderBy: { [query.sortBy ?? 'createdAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(
      items.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.payments[0]?.status ?? null,
        currency: order.currency,
        totalAmount: order.totalAmount.toFixed(2),
        customerEmail: order.customerEmail,
        shippingMethodName: order.shippingMethod?.name ?? null,
        createdAt: order.createdAt,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getScopedOrderForAdminOrThrow(storeId: string, orderNumber: string): Promise<OrderDetailRow> {
    const order = await this.prisma.order.findFirst({ where: { storeId, orderNumber }, include: ORDER_DETAIL_INCLUDE });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  toSafeDetail(order: OrderDetailRow) {
    const latestPayment = order.payments[0] ?? null;
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: latestPayment?.status ?? null,
      currency: order.currency,
      subtotal: order.subtotal.toFixed(2),
      taxAmount: order.taxAmount.toFixed(2),
      shippingAmount: order.shippingAmount.toFixed(2),
      discountAmount: order.discountAmount.toFixed(2),
      totalAmount: order.totalAmount.toFixed(2),
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      billingAddress: order.billingAddress,
      shippingAddress: order.shippingAddress,
      shippingMethodName: order.shippingMethodNameSnapshot,
      couponCode: order.couponCodeSnapshot,
      promotionName: order.promotionNameSnapshot,
      placedAt: order.placedAt,
      // Only statuses actually reached, in the order they were reached -
      // never a fabricated future timestamp (Phase 6 §22). "Confirmed"
      // deliberately isn't written here at all - it comes from the
      // captured Payment's own paidAt (already the authoritative moment
      // payment succeeded), not a duplicate write into this table.
      statusTimeline: order.statusHistory.map((entry) => ({ status: entry.newStatus, at: entry.createdAt })),
      confirmedAt: order.payments.find((p) => p.status === 'CAPTURED')?.paidAt ?? null,
      items: order.items.map((item) => ({
        // Phase 8: the customer needs their own OrderItem id to submit a
        // review for it (POST /reviews requires orderItemId) - previously
        // omitted here entirely, which would have made review submission
        // impossible to wire from the real API response despite the
        // backend accepting it. Safe to expose to the order's OWNING
        // customer (and to admin, which spreads this same shape) - it is
        // no more sensitive than productId/variantId, already returned
        // alongside it.
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        name: item.productNameSnapshot,
        variantName: item.variantNameSnapshot,
        sku: item.skuSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        image: item.imageUrlSnapshot,
      })),
    };
  }

  /**
   * Richer admin view (Phase 6 §20) - includes every payment attempt with
   * its provider identifiers, never just the latest one. Still never
   * exposes a provider SECRET (none is ever stored on Payment in the first
   * place - only providerOrderId/providerPaymentId, which are opaque
   * third-party reference ids, not credentials).
   */
  toAdminDetail(order: OrderDetailRow) {
    return {
      ...this.toSafeDetail(order),
      orderId: order.id,
      userId: order.userId,
      fulfilledAt: order.fulfilledAt,
      shippingMethodId: order.shippingMethodId,
      couponId: order.couponId,
      payments: order.payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        providerOrderId: payment.providerOrderId,
        providerPaymentId: payment.providerPaymentId,
        status: payment.status,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        failureReason: payment.failureReason,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      })),
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
    );
  }
}
