import { useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { NoAccess } from '../../components/NoAccess';
import { DateRangeControl } from '../../components/analytics/DateRangeControl';
import { pageHeaderStyle } from '../../styles';
import { DEFAULT_DATE_RANGE } from '../../lib/analytics-range';
import { OverviewSection } from './sections/OverviewSection';
import { SalesSection } from './sections/SalesSection';
import { OrdersSection } from './sections/OrdersSection';
import { ProductsSection } from './sections/ProductsSection';
import { CustomersSection } from './sections/CustomersSection';
import { InventorySection } from './sections/InventorySection';
import { ReturnsSection } from './sections/ReturnsSection';
import { RefundsSection } from './sections/RefundsSection';
import { PaymentsSection } from './sections/PaymentsSection';
import { FulfillmentSection } from './sections/FulfillmentSection';
import { PromotionsSection } from './sections/PromotionsSection';
import { ReconciliationSection } from './sections/ReconciliationSection';

/**
 * Analytics & Business Dashboard (Phase 11). Every section below fetches its
 * own endpoint independently, gates itself on its own `analytics.*`
 * permission (rendering nothing rather than an error when the admin lacks
 * it), and carries its own loading/error/empty state - one section failing
 * or lacking permission never blocks the rest of the page. All sections
 * except Inventory and Reconciliation (plain snapshots) share the same
 * date-range selection, passed straight through to the backend.
 */
export function AnalyticsPage() {
  const { hasPermission } = useAuth();
  const [range, setRange] = useState(DEFAULT_DATE_RANGE);

  if (!hasPermission('analytics.read')) {
    return <NoAccess message="You don't have permission to view analytics." />;
  }

  return (
    <div>
      <div style={pageHeaderStyle}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Analytics</h1>
      </div>

      <DateRangeControl value={range} onChange={setRange} />

      <OverviewSection range={range} />
      <SalesSection range={range} />
      <OrdersSection range={range} />
      <ProductsSection range={range} />
      <CustomersSection range={range} />
      <InventorySection />
      <ReturnsSection range={range} />
      <RefundsSection range={range} />
      <PaymentsSection range={range} />
      <FulfillmentSection range={range} />
      <PromotionsSection range={range} />
      <ReconciliationSection />
    </div>
  );
}
