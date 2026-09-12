import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { TopListQueryDto } from './dto/top-list-query.dto';
import { resolveDateRange, ResolvedDateRange } from './analytics-date-range.util';

/**
 * §3/§31/§32/§33 - the authoritative status sets every financial metric in
 * this service is built from. Documented once, here, rather than re-derived
 * ad-hoc per query, so every endpoint agrees on exactly what "a sale" means.
 *
 * EVER_PAID_STATUSES ("Gross Sales" / "Discounts" denominator): every
 * status except PENDING_PAYMENT. An order only ever LEAVES PENDING_PAYMENT
 * when PaymentService has confirmed a real CAPTURED payment (an invariant
 * enforced and independently tested since Phase 5/6) - so this set is
 * exactly "orders for which real money was captured," including one later
 * CANCELLED (Phase 6's own documented policy: cancellation never touches a
 * CAPTURED Payment - the cash was genuinely received, so excluding it from
 * Gross Sales would UNDERSTATE actual captured revenue, not correct it).
 *
 * ACTIVE_CONFIRMED_STATUSES ("Average Order Value" numerator/denominator,
 * and the "Confirmed/Delivered" order-count KPIs): explicitly excludes
 * CANCELLED (§5's own instruction: "Do not divide by cancelled or unpaid
 * orders") as well as PENDING_PAYMENT. This is a DELIBERATELY different,
 * narrower set than EVER_PAID_STATUSES - AOV answers "how big is a normal,
 * still-valid order," not "how much cash came in."
 */
const EVER_PAID_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
const ACTIVE_CONFIRMED_STATUSES = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] as const;
const ALL_ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  return value ? Number(value) : 0;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  async resolveRange(storeId: string, query: AnalyticsQueryDto): Promise<ResolvedDateRange> {
    const settings = await this.storeSettingsService.getAllSettings(storeId);
    return resolveDateRange(query, settings.timezone ?? 'UTC');
  }

  // -------------------------------------------------------------------
  // §5/§17 - Overview (the KPI cards)
  // -------------------------------------------------------------------

  async getOverview(storeId: string, range: ResolvedDateRange) {
    const [sales, orders, customers] = await Promise.all([this.computeSales(storeId, range), this.computeOrderCounts(storeId, range), this.computeCustomerCounts(storeId, range)]);
    return { range: this.serializeRange(range), sales, orders, customers, averageOrderValue: sales.averageOrderValue };
  }

  // -------------------------------------------------------------------
  // §5/§7 - Sales
  // -------------------------------------------------------------------

  private async computeSales(storeId: string, range: ResolvedDateRange) {
    const orderAgg = await this.prisma.order.aggregate({
      where: { storeId, placedAt: { gte: range.from, lte: range.to }, status: { in: [...EVER_PAID_STATUSES] } },
      _sum: { subtotal: true, discountAmount: true },
    });
    const grossSales = decimalToNumber(orderAgg._sum.subtotal);
    const discounts = decimalToNumber(orderAgg._sum.discountAmount);

    // §3 - successful refunds are booked in the period they actually
    // COMPLETED (succeededAt), never retroactively adjusting the original
    // order's own period - a standard, documented cash-basis choice (see
    // the Phase 11 report's Financial Calculation Rules section).
    const refundAgg = await this.prisma.refund.aggregate({
      where: { storeId, status: 'SUCCEEDED', succeededAt: { gte: range.from, lte: range.to } },
      _sum: { amount: true },
    });
    const successfulRefunds = decimalToNumber(refundAgg._sum.amount);
    const netSales = grossSales - discounts - successfulRefunds;

    const aovAgg = await this.prisma.order.aggregate({
      where: { storeId, placedAt: { gte: range.from, lte: range.to }, status: { in: [...ACTIVE_CONFIRMED_STATUSES] } },
      _sum: { totalAmount: true },
      _count: true,
    });
    const aovOrderCount = aovAgg._count;
    const aovTotal = decimalToNumber(aovAgg._sum.totalAmount);
    const averageOrderValue = aovOrderCount > 0 ? aovTotal / aovOrderCount : 0;

    return {
      grossSales,
      discounts,
      successfulRefunds,
      netSales,
      averageOrderValue,
      /** §5/§18 - documented denominator: COUNT(orders) with status in {CONFIRMED,PROCESSING,PACKED,SHIPPED,DELIVERED}, placed within range. Never PENDING_PAYMENT or CANCELLED. */
      averageOrderValueDenominator: aovOrderCount,
    };
  }

  private async computeOrderCounts(storeId: string, range: ResolvedDateRange) {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { storeId, placedAt: { gte: range.from, lte: range.to } },
      _count: true,
    });
    const byStatus: Record<string, number> = Object.fromEntries(ALL_ORDER_STATUSES.map((s) => [s, 0]));
    let total = 0;
    for (const row of grouped) {
      byStatus[row.status] = row._count;
      total += row._count;
    }
    return {
      total,
      confirmed: byStatus.CONFIRMED,
      delivered: byStatus.DELIVERED,
      cancelled: byStatus.CANCELLED,
      pendingPayment: byStatus.PENDING_PAYMENT,
      byStatus,
    };
  }

  private async computeCustomerCounts(storeId: string, range: ResolvedDateRange) {
    const [totalCustomers, newCustomers, distinctBuyers] = await Promise.all([
      this.prisma.user.count({ where: { storeId, type: 'CUSTOMER' } }),
      this.prisma.user.count({ where: { storeId, type: 'CUSTOMER', createdAt: { gte: range.from, lte: range.to } } }),
      this.prisma.order.findMany({
        where: { storeId, placedAt: { gte: range.from, lte: range.to }, status: { in: [...ACTIVE_CONFIRMED_STATUSES] } },
        distinct: ['userId'],
        select: { userId: true },
      }),
    ]);
    const buyerIds = distinctBuyers.map((b) => b.userId);
    const repeatBuyers =
      buyerIds.length === 0
        ? []
        : await this.prisma.$queryRaw<{ userId: string }[]>`
            SELECT "userId" FROM orders
            WHERE "storeId" = ${storeId} AND "userId" = ANY(${buyerIds}) AND status = ANY(${[...ACTIVE_CONFIRMED_STATUSES]}::"OrderStatus"[])
            GROUP BY "userId" HAVING COUNT(*) > 1`;

    return {
      totalCustomers,
      newCustomers,
      customersWithCompletedOrders: buyerIds.length,
      returningCustomers: repeatBuyers.length,
    };
  }

  /** §7 - daily/weekly/monthly sales trend, purely SQL-aggregated (never findMany + JS aggregation - §21). */
  async getSalesTrend(storeId: string, range: ResolvedDateRange, granularity: 'daily' | 'weekly' | 'monthly') {
    const bucket = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';
    const rows = await this.prisma.$queryRaw<{ bucket: Date; orders: bigint; gross: Prisma.Decimal; discounts: Prisma.Decimal }[]>`
      SELECT date_trunc(${bucket}, "placedAt") AS bucket, COUNT(*)::int AS orders, COALESCE(SUM(subtotal), 0) AS gross, COALESCE(SUM("discountAmount"), 0) AS discounts
      FROM orders
      WHERE "storeId" = ${storeId} AND "placedAt" BETWEEN ${range.from} AND ${range.to} AND status = ANY(${[...EVER_PAID_STATUSES]}::"OrderStatus"[])
      GROUP BY bucket ORDER BY bucket ASC`;
    const refundRows = await this.prisma.$queryRaw<{ bucket: Date; refunds: Prisma.Decimal }[]>`
      SELECT date_trunc(${bucket}, "succeededAt") AS bucket, COALESCE(SUM(amount), 0) AS refunds
      FROM refunds
      WHERE "storeId" = ${storeId} AND status = 'SUCCEEDED' AND "succeededAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY bucket ORDER BY bucket ASC`;
    const refundByBucket = new Map(refundRows.map((r) => [r.bucket.toISOString(), decimalToNumber(r.refunds)]));

    return rows.map((row) => {
      const gross = decimalToNumber(row.gross);
      const discounts = decimalToNumber(row.discounts);
      const refunds = refundByBucket.get(row.bucket.toISOString()) ?? 0;
      return { date: row.bucket.toISOString(), orders: Number(row.orders), grossSales: gross, discounts, refunds, netSales: gross - discounts - refunds };
    });
  }

  /** §7 - sales by product/category/brand, always using OrderItem's own frozen snapshot fields (§8) so a later-archived/deleted product never breaks historical analytics. */
  async getSalesByProduct(storeId: string, range: ResolvedDateRange, query: TopListQueryDto) {
    // §21 - the ORDER BY column name itself cannot be a bind parameter in
    // SQL (parameterization only covers values, never identifiers), so it
    // is interpolated directly - but ONLY ever one of these two hardcoded
    // literals this code itself produces (never the raw `query.sortBy`
    // string, which the DTO's own @IsIn(['revenue','units']) already
    // restricts before this method is even reached). Every other dynamic
    // value below ($1-$5) is a genuine bind parameter.
    const orderBy = query.sortBy === 'units' ? 'unitsSold' : 'grossSales';
    const rows = await this.prisma.$queryRawUnsafe<{ productId: string | null; productName: string; sku: string; unitsSold: bigint; grossSales: Prisma.Decimal }[]>(
      `SELECT oi."productId" AS "productId", MAX(oi."productNameSnapshot") AS "productName", MAX(oi."skuSnapshot") AS sku,
              SUM(oi.quantity)::int AS "unitsSold", COALESCE(SUM(oi."lineTotal"), 0) AS "grossSales"
       FROM order_items oi
       JOIN orders o ON o.id = oi."orderId"
       WHERE o."storeId" = $1 AND o."placedAt" BETWEEN $2 AND $3 AND o.status = ANY($4::"OrderStatus"[])
       GROUP BY oi."productId"
       ORDER BY "${orderBy}" DESC
       LIMIT $5`,
      storeId,
      range.from,
      range.to,
      [...EVER_PAID_STATUSES],
      query.limit,
    );

    const productIds = rows.map((r) => r.productId).filter((id): id is string => id !== null);
    const refundByProduct = await this.getRefundAmountByProduct(storeId, range, productIds);

    return rows.map((row) => {
      const grossSales = decimalToNumber(row.grossSales);
      const refundAmount = refundByProduct.get(row.productId ?? '') ?? 0;
      return { productId: row.productId, productName: row.productName, sku: row.sku, unitsSold: Number(row.unitsSold), grossSales, refundAmount, netSales: grossSales - refundAmount };
    });
  }

  /** Return-item refund allocation per product, for the SAME date range's succeeded refunds (§8's "refunds where applicable"). */
  private async getRefundAmountByProduct(storeId: string, range: ResolvedDateRange, productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ productId: string | null; amount: Prisma.Decimal }[]>`
      SELECT oi."productId" AS "productId", COALESCE(SUM(ri."refundAmount"), 0) AS amount
      FROM return_items ri
      JOIN refunds rf ON rf."returnRequestId" = ri."returnRequestId"
      JOIN order_items oi ON oi.id = ri."orderItemId"
      WHERE rf."storeId" = ${storeId} AND rf.status = 'SUCCEEDED' AND rf."succeededAt" BETWEEN ${range.from} AND ${range.to} AND oi."productId" = ANY(${productIds})
      GROUP BY oi."productId"`;
    return new Map(rows.map((r) => [r.productId ?? '', decimalToNumber(r.amount)]));
  }

  async getSalesByCategory(storeId: string, range: ResolvedDateRange, query: TopListQueryDto) {
    const rows = await this.prisma.$queryRaw<{ categoryId: string; categoryName: string; unitsSold: bigint; sales: Prisma.Decimal }[]>`
      SELECT c.id AS "categoryId", c.name AS "categoryName", SUM(oi.quantity)::int AS "unitsSold", COALESCE(SUM(oi."lineTotal"), 0) AS sales
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      JOIN product_categories pc ON pc."productId" = oi."productId"
      JOIN categories c ON c.id = pc."categoryId"
      WHERE o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to} AND o.status = ANY(${[...EVER_PAID_STATUSES]}::"OrderStatus"[])
      GROUP BY c.id, c.name
      ORDER BY sales DESC
      LIMIT ${query.limit}`;
    const totalSales = rows.reduce((sum, r) => sum + decimalToNumber(r.sales), 0);
    return rows.map((row) => {
      const sales = decimalToNumber(row.sales);
      return { categoryId: row.categoryId, categoryName: row.categoryName, unitsSold: Number(row.unitsSold), sales, percentage: totalSales > 0 ? (sales / totalSales) * 100 : 0 };
    });
  }

  async getSalesByBrand(storeId: string, range: ResolvedDateRange, query: TopListQueryDto) {
    const rows = await this.prisma.$queryRaw<{ brandId: string; brandName: string; unitsSold: bigint; sales: Prisma.Decimal }[]>`
      SELECT b.id AS "brandId", b.name AS "brandName", SUM(oi.quantity)::int AS "unitsSold", COALESCE(SUM(oi."lineTotal"), 0) AS sales
      FROM order_items oi
      JOIN orders o ON o.id = oi."orderId"
      JOIN products p ON p.id = oi."productId"
      JOIN brands b ON b.id = p."brandId"
      WHERE o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to} AND o.status = ANY(${[...EVER_PAID_STATUSES]}::"OrderStatus"[])
      GROUP BY b.id, b.name
      ORDER BY sales DESC
      LIMIT ${query.limit}`;
    const totalSales = rows.reduce((sum, r) => sum + decimalToNumber(r.sales), 0);
    return rows.map((row) => {
      const sales = decimalToNumber(row.sales);
      return { brandId: row.brandId, brandName: row.brandName, unitsSold: Number(row.unitsSold), sales, percentage: totalSales > 0 ? (sales / totalSales) * 100 : 0 };
    });
  }

  // -------------------------------------------------------------------
  // §6 - Orders
  // -------------------------------------------------------------------

  async getOrders(storeId: string, range: ResolvedDateRange) {
    const [counts, trend, itemsAgg] = await Promise.all([
      this.computeOrderCounts(storeId, range),
      this.getSalesTrend(storeId, range, 'daily'),
      this.prisma.$queryRaw<{ avgItems: number }[]>`
        SELECT COALESCE(AVG(item_counts.cnt), 0)::float AS "avgItems" FROM (
          SELECT o.id, COUNT(oi.id) AS cnt FROM orders o
          JOIN order_items oi ON oi."orderId" = o.id
          WHERE o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to} AND o.status = ANY(${[...EVER_PAID_STATUSES]}::"OrderStatus"[])
          GROUP BY o.id
        ) item_counts`,
    ]);
    return { ...counts, dailyTrend: trend.map((t) => ({ date: t.date, orders: t.orders, sales: t.netSales })), averageItemsPerOrder: itemsAgg[0]?.avgItems ?? 0 };
  }

  // -------------------------------------------------------------------
  // §8 - Product performance
  // -------------------------------------------------------------------

  async getProducts(storeId: string, range: ResolvedDateRange, query: TopListQueryDto) {
    const topByRevenue = await this.getSalesByProduct(storeId, range, { ...query, sortBy: 'revenue' });
    const topByUnits = await this.getSalesByProduct(storeId, range, { ...query, sortBy: 'units' });

    const zeroSalesRows = await this.prisma.$queryRaw<{ id: string; name: string; sku: string | null }[]>`
      SELECT p.id, p.name, p.sku FROM products p
      WHERE p."storeId" = ${storeId} AND p."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi."orderId"
          WHERE oi."productId" = p.id AND o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to} AND o.status = ANY(${[...EVER_PAID_STATUSES]}::"OrderStatus"[])
        )
      ORDER BY p."createdAt" DESC
      LIMIT ${query.limit}`;

    return {
      topByRevenue,
      topByUnits,
      lowestSelling: [...topByUnits].reverse(),
      zeroSalesProducts: zeroSalesRows.map((r) => ({ productId: r.id, productName: r.name, sku: r.sku })),
    };
  }

  // -------------------------------------------------------------------
  // §9 - Customers
  // -------------------------------------------------------------------

  async getCustomers(storeId: string, range: ResolvedDateRange, query: TopListQueryDto) {
    const growthRows = await this.prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS bucket, COUNT(*)::int AS count
      FROM users WHERE "storeId" = ${storeId} AND type = 'CUSTOMER' AND "createdAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY bucket ORDER BY bucket ASC`;

    const counts = await this.computeCustomerCounts(storeId, range);
    const oneTimeCustomers = counts.customersWithCompletedOrders - counts.returningCustomers;
    const avgOrdersPerCustomer = counts.customersWithCompletedOrders > 0 ? await this.getAverageOrdersPerCustomer(storeId, range) : 0;

    // §9 - only an admin-safe identifier set: email/name, never password/refreshToken/secrets.
    const topCustomers = await this.prisma.$queryRaw<{ userId: string; email: string; firstName: string | null; lastName: string | null; orderCount: bigint; totalSpend: Prisma.Decimal; lastOrderDate: Date }[]>`
      SELECT o."userId", u.email, u."firstName", u."lastName", COUNT(*)::int AS "orderCount", COALESCE(SUM(o."totalAmount"), 0) AS "totalSpend", MAX(o."placedAt") AS "lastOrderDate"
      FROM orders o JOIN users u ON u.id = o."userId"
      WHERE o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to} AND o.status = ANY(${[...ACTIVE_CONFIRMED_STATUSES]}::"OrderStatus"[])
      GROUP BY o."userId", u.email, u."firstName", u."lastName"
      ORDER BY "totalSpend" DESC
      LIMIT ${query.limit}`;

    return {
      growth: growthRows.map((r) => ({ date: r.bucket.toISOString(), newCustomers: Number(r.count) })),
      ...counts,
      oneTimeCustomers,
      averageOrdersPerCustomer: avgOrdersPerCustomer,
      topCustomers: topCustomers.map((r) => ({ userId: r.userId, email: r.email, firstName: r.firstName, lastName: r.lastName, orderCount: Number(r.orderCount), totalSpend: decimalToNumber(r.totalSpend), lastOrderDate: r.lastOrderDate.toISOString() })),
    };
  }

  private async getAverageOrdersPerCustomer(storeId: string, range: ResolvedDateRange): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ avg: number }[]>`
      SELECT COALESCE(AVG(cnt), 0)::float AS avg FROM (
        SELECT "userId", COUNT(*) AS cnt FROM orders
        WHERE "storeId" = ${storeId} AND "placedAt" BETWEEN ${range.from} AND ${range.to} AND status = ANY(${[...ACTIVE_CONFIRMED_STATUSES]}::"OrderStatus"[])
        GROUP BY "userId"
      ) x`;
    return rows[0]?.avg ?? 0;
  }

  // -------------------------------------------------------------------
  // §10 - Inventory (read-only, never mutates - §10's explicit requirement)
  // -------------------------------------------------------------------

  async getInventory(storeId: string) {
    const totals = await this.prisma.inventoryItem.aggregate({
      where: { storeId },
      _sum: { onHandQuantity: true, availableQuantity: true, reservedQuantity: true, committedQuantity: true },
    });

    const lowStockRows = await this.prisma.$queryRaw<{ id: string; productName: string; warehouseName: string; available: number; threshold: number }[]>`
      SELECT ii.id, p.name AS "productName", w.name AS "warehouseName", ii."availableQuantity" AS available, ii."lowStockThreshold" AS threshold
      FROM inventory_items ii JOIN products p ON p.id = ii."productId" JOIN warehouses w ON w.id = ii."warehouseId"
      WHERE ii."storeId" = ${storeId} AND ii."availableQuantity" > 0 AND ii."availableQuantity" <= ii."lowStockThreshold"
      ORDER BY ii."availableQuantity" ASC LIMIT 50`;

    const outOfStockRows = await this.prisma.$queryRaw<{ id: string; productName: string; warehouseName: string }[]>`
      SELECT ii.id, p.name AS "productName", w.name AS "warehouseName"
      FROM inventory_items ii JOIN products p ON p.id = ii."productId" JOIN warehouses w ON w.id = ii."warehouseId"
      WHERE ii."storeId" = ${storeId} AND ii."availableQuantity" <= 0
      ORDER BY p.name ASC LIMIT 50`;

    const byWarehouse = await this.prisma.inventoryItem.groupBy({
      by: ['warehouseId'],
      where: { storeId },
      _sum: { onHandQuantity: true, availableQuantity: true, reservedQuantity: true },
    });
    const warehouses = await this.prisma.warehouse.findMany({ where: { id: { in: byWarehouse.map((w) => w.warehouseId) } }, select: { id: true, name: true } });
    const warehouseNames = new Map(warehouses.map((w) => [w.id, w.name]));

    return {
      totalOnHand: totals._sum.onHandQuantity ?? 0,
      totalAvailable: totals._sum.availableQuantity ?? 0,
      totalReserved: totals._sum.reservedQuantity ?? 0,
      totalCommitted: totals._sum.committedQuantity ?? 0,
      lowStockProducts: lowStockRows,
      outOfStockProducts: outOfStockRows,
      byWarehouse: byWarehouse.map((w) => ({
        warehouseId: w.warehouseId,
        warehouseName: warehouseNames.get(w.warehouseId) ?? w.warehouseId,
        onHand: w._sum.onHandQuantity ?? 0,
        available: w._sum.availableQuantity ?? 0,
        reserved: w._sum.reservedQuantity ?? 0,
      })),
    };
  }

  // -------------------------------------------------------------------
  // §12 - Payments (§12's explicit "1 order, 2 attempts = 1 sale" rule)
  // -------------------------------------------------------------------

  async getPayments(storeId: string, range: ResolvedDateRange) {
    const grouped = await this.prisma.payment.groupBy({
      by: ['status'],
      where: { storeId, createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      _sum: { amount: true },
    });
    const byStatus: Record<string, { count: number; amount: number }> = {};
    let totalAttempts = 0;
    for (const row of grouped) {
      byStatus[row.status] = { count: row._count, amount: decimalToNumber(row._sum.amount) };
      totalAttempts += row._count;
    }
    const captured = byStatus.CAPTURED ?? { count: 0, amount: 0 };
    const failed = byStatus.FAILED ?? { count: 0, amount: 0 };
    const pending = (byStatus.CREATED?.count ?? 0) + (byStatus.PENDING?.count ?? 0) + (byStatus.AUTHORIZED?.count ?? 0);

    // §12 - the number of distinct ORDERS that were actually sold, never
    // conflated with the number of payment ATTEMPTS - one retried order
    // (1 FAILED + 1 CAPTURED attempt) counts as exactly one sale here.
    const distinctSuccessfulOrders = await this.prisma.payment.findMany({
      where: { storeId, status: 'CAPTURED', createdAt: { gte: range.from, lte: range.to } },
      distinct: ['orderId'],
      select: { orderId: true },
    });

    return {
      totalAttempts,
      successfulPayments: captured.count,
      distinctSuccessfulSales: distinctSuccessfulOrders.length,
      failedPayments: failed.count,
      pendingPayments: pending,
      capturedAmount: captured.amount,
      failedAmount: failed.amount,
      successRate: totalAttempts > 0 ? captured.count / totalAttempts : 0,
    };
  }

  // -------------------------------------------------------------------
  // §11/§32 - Refunds (never merges UNKNOWN into SUCCEEDED or FAILED)
  // -------------------------------------------------------------------

  async getRefunds(storeId: string, range: ResolvedDateRange) {
    const grouped = await this.prisma.refund.groupBy({
      by: ['status'],
      where: { storeId, createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      _sum: { amount: true },
    });
    const byStatus: Record<string, { count: number; amount: number }> = {};
    let totalCount = 0;
    for (const row of grouped) {
      byStatus[row.status] = { count: row._count, amount: decimalToNumber(row._sum.amount) };
      totalCount += row._count;
    }
    return {
      totalRefunds: totalCount,
      successfulCount: byStatus.SUCCEEDED?.count ?? 0,
      failedCount: byStatus.FAILED?.count ?? 0,
      unknownCount: byStatus.UNKNOWN?.count ?? 0,
      successfulAmount: byStatus.SUCCEEDED?.amount ?? 0,
      failedAmount: byStatus.FAILED?.amount ?? 0,
      /** §11/§32 - never classified as successful or failed; a separate operational-risk figure that must be actively reconciled. */
      unresolvedUnknownAmount: byStatus.UNKNOWN?.amount ?? 0,
    };
  }

  // -------------------------------------------------------------------
  // §11/§33 - Returns (never revenue - only their SUCCEEDED refund is)
  // -------------------------------------------------------------------

  async getReturns(storeId: string, range: ResolvedDateRange) {
    const grouped = await this.prisma.returnRequest.groupBy({
      by: ['status'],
      where: { storeId, requestedAt: { gte: range.from, lte: range.to } },
      _count: true,
    });
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of grouped) {
      byStatus[row.status] = row._count;
      total += row._count;
    }
    const quantityAgg = await this.prisma.returnItem.aggregate({
      where: { returnRequest: { storeId, requestedAt: { gte: range.from, lte: range.to } } },
      _sum: { quantity: true },
    });

    // §16 - duration analytics from the ReturnRequest's own timestamps
    // only; null (never 0) whenever either endpoint is missing (§16's
    // explicit "do not interpret missing data as instant processing").
    const durations = await this.prisma.$queryRaw<{ avgRequestToApproval: number | null; avgApprovalToReceived: number | null; avgReceivedToRefundInitiated: number | null; avgRefundInitiatedToCompleted: number | null }[]>`
      SELECT
        (AVG(EXTRACT(EPOCH FROM ("approvedAt" - "requestedAt"))) FILTER (WHERE "approvedAt" IS NOT NULL))::float AS "avgRequestToApproval",
        (AVG(EXTRACT(EPOCH FROM ("receivedAt" - "approvedAt"))) FILTER (WHERE "receivedAt" IS NOT NULL AND "approvedAt" IS NOT NULL))::float AS "avgApprovalToReceived",
        (AVG(EXTRACT(EPOCH FROM ("refundInitiatedAt" - "receivedAt"))) FILTER (WHERE "refundInitiatedAt" IS NOT NULL AND "receivedAt" IS NOT NULL))::float AS "avgReceivedToRefundInitiated",
        (AVG(EXTRACT(EPOCH FROM ("completedAt" - "refundInitiatedAt"))) FILTER (WHERE "completedAt" IS NOT NULL AND "refundInitiatedAt" IS NOT NULL))::float AS "avgRefundInitiatedToCompleted"
      FROM return_requests WHERE "storeId" = ${storeId} AND "requestedAt" BETWEEN ${range.from} AND ${range.to}`;
    const d = durations[0];

    return {
      totalRequests: total,
      requestedQuantity: quantityAgg._sum.quantity ?? 0,
      approved: byStatus.APPROVED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
      received: byStatus.RECEIVED ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      byStatus,
      averageDurationsSeconds: {
        requestToApproval: d?.avgRequestToApproval ?? null,
        approvalToReceived: d?.avgApprovalToReceived ?? null,
        receivedToRefundInitiated: d?.avgReceivedToRefundInitiated ?? null,
        refundInitiatedToCompleted: d?.avgRefundInitiatedToCompleted ?? null,
      },
    };
  }

  // -------------------------------------------------------------------
  // §13 - Coupons/Promotions (only CONSUMED represents completed usage)
  // -------------------------------------------------------------------

  async getPromotions(storeId: string, range: ResolvedDateRange) {
    const grouped = await this.prisma.couponRedemption.groupBy({
      by: ['status'],
      where: { storeId, createdAt: { gte: range.from, lte: range.to } },
      _count: true,
      _sum: { discountAmount: true },
    });
    const byStatus: Record<string, { count: number; amount: number }> = {};
    for (const row of grouped) byStatus[row.status] = { count: row._count, amount: decimalToNumber(row._sum.discountAmount) };

    const topCoupons = await this.prisma.$queryRaw<{ code: string; redemptions: bigint; discountValue: Prisma.Decimal }[]>`
      SELECT c.code, COUNT(*)::int AS redemptions, COALESCE(SUM(cr."discountAmount"), 0) AS "discountValue"
      FROM coupon_redemptions cr JOIN coupons c ON c.id = cr."couponId"
      WHERE cr."storeId" = ${storeId} AND cr.status = 'CONSUMED' AND cr."createdAt" BETWEEN ${range.from} AND ${range.to}
      GROUP BY c.code ORDER BY "discountValue" DESC LIMIT 10`;

    return {
      consumedRedemptions: byStatus.CONSUMED?.count ?? 0,
      reservedRedemptions: byStatus.RESERVED?.count ?? 0,
      releasedRedemptions: byStatus.RELEASED?.count ?? 0,
      /** §13 - only CONSUMED contributes to discount-value reporting; RESERVED/RELEASED never count as completed usage. */
      totalDiscountValue: byStatus.CONSUMED?.amount ?? 0,
      topCoupons: topCoupons.map((r) => ({ code: r.code, redemptions: Number(r.redemptions), discountValue: decimalToNumber(r.discountValue) })),
    };
  }

  // -------------------------------------------------------------------
  // §14/§15 - Fulfillment (durations only from real OrderStatusHistory rows)
  // -------------------------------------------------------------------

  async getFulfillment(storeId: string, range: ResolvedDateRange) {
    const counts = await this.computeOrderCounts(storeId, range);
    const cancelledBeforeFulfillment = await this.prisma.order.count({
      where: { storeId, placedAt: { gte: range.from, lte: range.to }, status: 'CANCELLED', fulfilledAt: null },
    });

    // §15 - OrderStatusHistory has no plain `status` column (it records
    // `previousStatus`/`newStatus` per transition - see the schema), so
    // each row already self-describes its own transition; the only extra
    // fact needed is the IMMEDIATELY PRECEDING row's own timestamp for the
    // SAME order, obtained via LAG() rather than a manual self-join. A row
    // with no predecessor (LAG returns NULL - the order's very first
    // history entry) is excluded by the outer WHERE, so a duration is only
    // ever computed when BOTH endpoints genuinely exist (§15's explicit
    // "do not fabricate missing transitions" - never a false 0).
    const durations = await this.prisma.$queryRaw<{ transition: string; avgSeconds: number }[]>`
      SELECT transition, AVG(EXTRACT(EPOCH FROM (t."createdAt" - t."prevCreatedAt")))::float AS "avgSeconds"
      FROM (
        SELECT (h."previousStatus" || '_TO_' || h."newStatus") AS transition, h."newStatus", h."createdAt",
               LAG(h."createdAt") OVER (PARTITION BY h."orderId" ORDER BY h."createdAt") AS "prevCreatedAt"
        FROM order_status_history h
        JOIN orders o ON o.id = h."orderId"
        WHERE o."storeId" = ${storeId} AND o."placedAt" BETWEEN ${range.from} AND ${range.to}
      ) t
      WHERE t."newStatus" = ANY(${['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED']}::"OrderStatus"[]) AND t."prevCreatedAt" IS NOT NULL
      GROUP BY transition`;

    const deliveredPercentage = counts.total > 0 ? (counts.delivered / counts.total) * 100 : 0;

    return {
      processing: counts.byStatus.PROCESSING,
      packed: counts.byStatus.PACKED,
      shipped: counts.byStatus.SHIPPED,
      delivered: counts.delivered,
      cancelledBeforeFulfillment,
      deliveredPercentage,
      averageTransitionDurationsSeconds: Object.fromEntries(durations.map((d) => [d.transition, d.avgSeconds])),
    };
  }

  // -------------------------------------------------------------------
  // §29 - Reconciliation (diagnostic only - reports, never mutates)
  // -------------------------------------------------------------------

  async getReconciliation(storeId: string) {
    const capturedWithoutConfirmedOrder = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::int AS count FROM payments p JOIN orders o ON o.id = p."orderId"
      WHERE p."storeId" = ${storeId} AND p.status = 'CAPTURED' AND o.status = 'PENDING_PAYMENT'`;
    // CANCELLED is deliberately excluded: an order may be CANCELLED
    // directly from PENDING_PAYMENT (cancelled before ever paying - a
    // real, expected Phase 6 lifecycle path), so "CANCELLED with no
    // CAPTURED payment" is not an inconsistency and must never be
    // reported as one - a reconciliation tool that cries wolf on a
    // legitimate, routine state erodes the trust it exists to provide.
    // Only CONFIRMED-or-later statuses are guaranteed to have a captured
    // payment behind them (the Phase 5/6 invariant this whole project
    // already enforces).
    const confirmedWithoutCapturedPayment = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::int AS count FROM orders o
      WHERE o."storeId" = ${storeId} AND o.status IN ('CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED')
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id AND p.status = 'CAPTURED')`;
    const refundsExceedingBalance = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::int AS count FROM (
        SELECT rf."paymentId" FROM refunds rf JOIN payments p ON p.id = rf."paymentId"
        WHERE rf."storeId" = ${storeId} AND rf.status IN ('PENDING', 'PROCESSING', 'SUCCEEDED')
        GROUP BY rf."paymentId", p.amount HAVING SUM(rf.amount) > p.amount
      ) x`;
    const unknownRefunds = await this.prisma.refund.count({ where: { storeId, status: 'UNKNOWN' } });

    return {
      capturedPaymentsWithoutConfirmedOrder: Number(capturedWithoutConfirmedOrder[0]?.count ?? 0),
      confirmedOrdersWithoutCapturedPayment: Number(confirmedWithoutCapturedPayment[0]?.count ?? 0),
      refundsExceedingRefundableBalance: Number(refundsExceedingBalance[0]?.count ?? 0),
      unknownRefundsRequiringReconciliation: unknownRefunds,
    };
  }

  private serializeRange(range: ResolvedDateRange) {
    return { from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone, preset: range.preset };
  }
}
