import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { SalesQueryDto } from './dto/sales-query.dto';
import { TopListQueryDto } from './dto/top-list-query.dto';
import { toCsv } from './analytics-csv.util';

const GRANULARITY = ['daily', 'weekly', 'monthly'] as const;

/**
 * §18/§20 - every route derives storeId from the JWT only (@CurrentUser()),
 * exactly like every other admin controller in this codebase - the DTOs
 * below do not declare a storeId field, so a client-supplied one could
 * never be trusted even if sent. §19 - `analytics.read` gates the overview;
 * each specific report additionally requires its own narrower permission.
 */
@ApiTags('admin-analytics')
@UseGuards(PermissionsGuard)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Permissions('analytics.read')
  @Get('overview')
  async overview(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getOverview(user.storeId, range);
  }

  @Permissions('analytics.sales')
  @Get('sales')
  async sales(@CurrentUser() user: AuthenticatedUser, @Query() query: SalesQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const granularity = GRANULARITY.includes(query.granularity as (typeof GRANULARITY)[number]) ? (query.granularity as (typeof GRANULARITY)[number]) : 'daily';
    const [trend, byProduct, byCategory, byBrand] = await Promise.all([
      this.analyticsService.getSalesTrend(user.storeId, range, granularity),
      this.analyticsService.getSalesByProduct(user.storeId, range, { preset: query.preset, from: query.from, to: query.to, timezone: query.timezone, limit: 10, sortBy: 'revenue' }),
      this.analyticsService.getSalesByCategory(user.storeId, range, { preset: query.preset, from: query.from, to: query.to, timezone: query.timezone, limit: 10, sortBy: 'revenue' }),
      this.analyticsService.getSalesByBrand(user.storeId, range, { preset: query.preset, from: query.from, to: query.to, timezone: query.timezone, limit: 10, sortBy: 'revenue' }),
    ]);
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), timezone: range.timezone, preset: range.preset }, trend, byProduct, byCategory, byBrand };
  }

  @Permissions('analytics.orders')
  @Get('orders')
  async orders(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getOrders(user.storeId, range);
  }

  @Permissions('analytics.products')
  @Get('products')
  async products(@CurrentUser() user: AuthenticatedUser, @Query() query: TopListQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getProducts(user.storeId, range, query);
  }

  @Permissions('analytics.customers')
  @Get('customers')
  async customers(@CurrentUser() user: AuthenticatedUser, @Query() query: TopListQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getCustomers(user.storeId, range, query);
  }

  @Permissions('analytics.inventory')
  @Get('inventory')
  async inventory(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getInventory(user.storeId);
  }

  @Permissions('analytics.payments')
  @Get('payments')
  async payments(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getPayments(user.storeId, range);
  }

  @Permissions('analytics.refunds')
  @Get('refunds')
  async refunds(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getRefunds(user.storeId, range);
  }

  @Permissions('analytics.returns')
  @Get('returns')
  async returns(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getReturns(user.storeId, range);
  }

  @Permissions('analytics.promotions')
  @Get('promotions')
  async promotions(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getPromotions(user.storeId, range);
  }

  @Permissions('analytics.read')
  @Get('fulfillment')
  async fulfillment(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    return this.analyticsService.getFulfillment(user.storeId, range);
  }

  /** §29 - operational diagnostic only; never mutates anything. */
  @Permissions('analytics.read')
  @Get('reconciliation')
  async reconciliation(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.getReconciliation(user.storeId);
  }

  /** §28 - CSV export, built from the SAME authoritative queries as the JSON reports above - never a separately-computed number. */
  @Permissions('analytics.read')
  @Get('export/sales')
  async exportSales(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const trend = await this.analyticsService.getSalesTrend(user.storeId, range, 'daily');
    const csv = toCsv(['date', 'orders', 'grossSales', 'discounts', 'refunds', 'netSales'], trend);
    return this.sendCsv(res, user, 'sales', csv);
  }

  @Permissions('analytics.read')
  @Get('export/products')
  async exportProducts(@CurrentUser() user: AuthenticatedUser, @Query() query: TopListQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const rows = await this.analyticsService.getSalesByProduct(user.storeId, range, { ...query, limit: 100 });
    const csv = toCsv(['productId', 'productName', 'sku', 'unitsSold', 'grossSales', 'refundAmount', 'netSales'], rows);
    return this.sendCsv(res, user, 'products', csv);
  }

  @Permissions('analytics.customers')
  @Get('export/customers')
  async exportCustomers(@CurrentUser() user: AuthenticatedUser, @Query() query: TopListQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const data = await this.analyticsService.getCustomers(user.storeId, range, { ...query, limit: 100 });
    const csv = toCsv(['userId', 'email', 'firstName', 'lastName', 'orderCount', 'totalSpend', 'lastOrderDate'], data.topCustomers);
    return this.sendCsv(res, user, 'customers', csv);
  }

  @Permissions('analytics.orders')
  @Get('export/orders')
  async exportOrders(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const trend = await this.analyticsService.getSalesTrend(user.storeId, range, 'daily');
    const csv = toCsv(['date', 'orders', 'netSales'], trend.map((t) => ({ date: t.date, orders: t.orders, netSales: t.netSales })));
    return this.sendCsv(res, user, 'orders', csv);
  }

  @Permissions('analytics.refunds')
  @Get('export/refunds')
  async exportRefunds(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const data = await this.analyticsService.getRefunds(user.storeId, range);
    const csv = toCsv(
      ['metric', 'count', 'amount'],
      [
        { metric: 'successful', count: data.successfulCount, amount: data.successfulAmount },
        { metric: 'failed', count: data.failedCount, amount: data.failedAmount },
        { metric: 'unknown', count: data.unknownCount, amount: data.unresolvedUnknownAmount },
      ],
    );
    return this.sendCsv(res, user, 'refunds', csv);
  }

  @Permissions('analytics.returns')
  @Get('export/returns')
  async exportReturns(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto, @Res({ passthrough: true }) res: Response) {
    const range = await this.analyticsService.resolveRange(user.storeId, query);
    const data = await this.analyticsService.getReturns(user.storeId, range);
    const csv = toCsv(
      ['status', 'count'],
      Object.entries(data.byStatus).map(([status, count]) => ({ status, count })),
    );
    return this.sendCsv(res, user, 'returns', csv);
  }

  private async sendCsv(res: Response, user: AuthenticatedUser, table: string, csv: string): Promise<string> {
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="peshani-${table}-export.csv"`);
    await this.auditLogService.record({ storeId: user.storeId, userId: user.userId, action: 'ANALYTICS_EXPORTED', entityType: 'Analytics', metadata: { table } });
    return csv;
  }
}
