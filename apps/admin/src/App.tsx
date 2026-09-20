import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth-context';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { SubcategoriesPage } from './pages/subcategories/SubcategoriesPage';
import { BrandsPage } from './pages/brands/BrandsPage';
import { AttributesPage } from './pages/attributes/AttributesPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { ProductFormPage } from './pages/products/ProductFormPage';
import { WarehousesPage } from './pages/warehouses/WarehousesPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ShippingMethodsPage } from './pages/shipping-methods/ShippingMethodsPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { OrderDetailPage } from './pages/orders/OrderDetailPage';
import { ReturnsPage } from './pages/returns/ReturnsPage';
import { ReturnDetailPage } from './pages/returns/ReturnDetailPage';
import { PromotionsPage } from './pages/promotions/PromotionsPage';
import { CouponsPage } from './pages/promotions/CouponsPage';
import { ReviewsPage } from './pages/reviews/ReviewsPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { NotificationTemplatesPage } from './pages/notification-templates/NotificationTemplatesPage';
import { HomepageSlidesPage } from './pages/homepage-slides/HomepageSlidesPage';
import { BlogPostsPage } from './pages/blog/BlogPostsPage';
import { BlogPostFormPage } from './pages/blog/BlogPostFormPage';
import { StoreSettingsPage } from './pages/store-settings/StoreSettingsPage';
import { ContactMessagesPage } from './pages/contact-messages/ContactMessagesPage';

function ProtectedLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Layout />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/store-settings" element={<StoreSettingsPage />} />
        <Route path="/contact-messages" element={<ContactMessagesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/subcategories" element={<SubcategoriesPage />} />
        <Route path="/brands" element={<BrandsPage />} />
        <Route path="/attributes" element={<AttributesPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductFormPage />} />
        <Route path="/products/:id/edit" element={<ProductFormPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/shipping-methods" element={<ShippingMethodsPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderNumber" element={<OrderDetailPage />} />
        <Route path="/returns" element={<ReturnsPage />} />
        <Route path="/returns/:id" element={<ReturnDetailPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/coupons" element={<CouponsPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/notification-templates" element={<NotificationTemplatesPage />} />
        <Route path="/homepage-slides" element={<HomepageSlidesPage />} />
        <Route path="/blog" element={<BlogPostsPage />} />
        <Route path="/blog/new" element={<BlogPostFormPage />} />
        <Route path="/blog/:id/edit" element={<BlogPostFormPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
