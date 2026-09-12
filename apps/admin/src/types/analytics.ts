import { OrderStatus } from './orders';
import { ReturnStatus } from './returns';

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'last90days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'custom';

export interface AnalyticsRange {
  from: string;
  to: string;
  timezone: string;
  preset: string;
}

export type OrderStatusCounts = Record<OrderStatus, number>;

export interface ProductBreakdownRow {
  productId: string;
  productName: string;
  sku: string;
  unitsSold: number;
  grossSales: number;
  refundAmount: number;
  netSales: number;
}

export interface CategoryBreakdownRow {
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  sales: number;
  percentage: number;
}

export interface BrandBreakdownRow {
  brandId: string;
  brandName: string;
  unitsSold: number;
  sales: number;
  percentage: number;
}

export interface OverviewResponse {
  range: AnalyticsRange;
  sales: {
    grossSales: number;
    discounts: number;
    successfulRefunds: number;
    netSales: number;
    averageOrderValue: number;
    averageOrderValueDenominator: number;
  };
  orders: {
    total: number;
    confirmed: number;
    delivered: number;
    cancelled: number;
    pendingPayment: number;
    byStatus: OrderStatusCounts;
  };
  customers: {
    totalCustomers: number;
    newCustomers: number;
    customersWithCompletedOrders: number;
    returningCustomers: number;
  };
  averageOrderValue: number;
}

export type SalesGranularity = 'daily' | 'weekly' | 'monthly';

export interface SalesTrendPoint {
  date: string;
  orders: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
}

export interface SalesResponse {
  range: AnalyticsRange;
  trend: SalesTrendPoint[];
  byProduct: ProductBreakdownRow[];
  byCategory: CategoryBreakdownRow[];
  byBrand: BrandBreakdownRow[];
}

export interface OrdersDailyTrendPoint {
  date: string;
  orders: number;
  sales: number;
}

export interface OrdersResponse {
  range: AnalyticsRange;
  total: number;
  confirmed: number;
  delivered: number;
  cancelled: number;
  pendingPayment: number;
  byStatus: OrderStatusCounts;
  dailyTrend: OrdersDailyTrendPoint[];
  averageItemsPerOrder: number;
}

export interface ProductsResponse {
  range: AnalyticsRange;
  topByRevenue: ProductBreakdownRow[];
  topByUnits: ProductBreakdownRow[];
  lowestSelling: ProductBreakdownRow[];
  zeroSalesProducts: { productId: string; productName: string; sku: string }[];
}

export interface CustomerGrowthPoint {
  date: string;
  newCustomers: number;
}

export interface TopCustomerRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  orderCount: number;
  totalSpend: number;
  lastOrderDate: string;
}

export interface CustomersResponse {
  range: AnalyticsRange;
  growth: CustomerGrowthPoint[];
  totalCustomers: number;
  newCustomers: number;
  customersWithCompletedOrders: number;
  returningCustomers: number;
  oneTimeCustomers: number;
  averageOrdersPerCustomer: number;
  topCustomers: TopCustomerRow[];
}

export interface LowStockProductRow {
  id: string;
  productName: string;
  warehouseName: string;
  available: number;
  threshold: number;
}

export interface OutOfStockProductRow {
  id: string;
  productName: string;
  warehouseName: string;
}

export interface WarehouseInventoryRow {
  warehouseId: string;
  warehouseName: string;
  onHand: number;
  available: number;
  reserved: number;
}

export interface InventoryResponse {
  totalOnHand: number;
  totalAvailable: number;
  totalReserved: number;
  totalCommitted: number;
  lowStockProducts: LowStockProductRow[];
  outOfStockProducts: OutOfStockProductRow[];
  byWarehouse: WarehouseInventoryRow[];
}

export interface PaymentsResponse {
  range: AnalyticsRange;
  totalAttempts: number;
  successfulPayments: number;
  distinctSuccessfulSales: number;
  failedPayments: number;
  pendingPayments: number;
  capturedAmount: number;
  failedAmount: number;
  successRate: number;
}

export interface RefundsResponse {
  range: AnalyticsRange;
  totalRefunds: number;
  successfulCount: number;
  failedCount: number;
  unknownCount: number;
  successfulAmount: number;
  failedAmount: number;
  unresolvedUnknownAmount: number;
}

export type ReturnStatusCounts = Record<ReturnStatus, number>;

export interface ReturnsResponse {
  range: AnalyticsRange;
  totalRequests: number;
  requestedQuantity: number;
  approved: number;
  rejected: number;
  cancelled: number;
  received: number;
  completed: number;
  byStatus: ReturnStatusCounts;
  averageDurationsSeconds: {
    requestToApproval: number | null;
    approvalToReceived: number | null;
    receivedToRefundInitiated: number | null;
    refundInitiatedToCompleted: number | null;
  };
}

export interface TopCouponRow {
  code: string;
  redemptions: number;
  discountValue: number;
}

export interface PromotionsResponse {
  range: AnalyticsRange;
  consumedRedemptions: number;
  reservedRedemptions: number;
  releasedRedemptions: number;
  totalDiscountValue: number;
  topCoupons: TopCouponRow[];
}

export interface FulfillmentResponse {
  range: AnalyticsRange;
  processing: number;
  packed: number;
  shipped: number;
  delivered: number;
  cancelledBeforeFulfillment: number;
  deliveredPercentage: number;
  averageTransitionDurationsSeconds: Record<string, number>;
}

export interface ReconciliationResponse {
  capturedPaymentsWithoutConfirmedOrder: number;
  confirmedOrdersWithoutCapturedPayment: number;
  refundsExceedingRefundableBalance: number;
  unknownRefundsRequiringReconciliation: number;
}
