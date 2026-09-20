import { PrismaClient, UserType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const STORE_SLUG = 'peshani';

const PERMISSIONS = [
  { key: 'catalog.manage', description: 'Manage products, categories, brands and attributes' },
  { key: 'category.read', description: 'View categories' },
  { key: 'category.create', description: 'Create categories' },
  { key: 'category.update', description: 'Update categories, including reordering and moving parents' },
  { key: 'category.delete', description: 'Delete (soft-delete) categories' },
  { key: 'category.status', description: 'Activate or deactivate categories' },
  { key: 'brand.read', description: 'View brands' },
  { key: 'brand.create', description: 'Create brands' },
  { key: 'brand.update', description: 'Update brands' },
  { key: 'brand.delete', description: 'Delete (soft-delete) brands' },
  { key: 'brand.status', description: 'Activate or deactivate brands' },
  { key: 'attribute.read', description: 'View attributes' },
  { key: 'attribute.create', description: 'Create attributes' },
  { key: 'attribute.update', description: 'Update attributes' },
  { key: 'attribute.delete', description: 'Delete (soft-delete) attributes' },
  { key: 'attribute.status', description: 'Activate or deactivate attributes' },
  { key: 'attribute_value.read', description: 'View attribute values' },
  { key: 'attribute_value.create', description: 'Create attribute values' },
  { key: 'attribute_value.update', description: 'Update attribute values, including reordering' },
  { key: 'attribute_value.delete', description: 'Delete (soft-delete) attribute values' },
  { key: 'attribute_value.status', description: 'Activate or deactivate attribute values' },
  { key: 'product_variant.read', description: 'View product variants' },
  { key: 'product_variant.create', description: 'Create and generate product variants' },
  { key: 'product_variant.update', description: 'Update product variants' },
  { key: 'product_variant.delete', description: 'Delete (soft-delete) product variants' },
  { key: 'product_variant.status', description: 'Activate, deactivate or archive product variants' },
  { key: 'product.read', description: 'View products' },
  { key: 'product.create', description: 'Create and duplicate products' },
  { key: 'product.update', description: 'Update products, including category/brand/tag/attribute assignments' },
  { key: 'product.delete', description: 'Delete (soft-delete) products' },
  { key: 'product.status', description: 'Change product lifecycle status' },
  { key: 'product_media.read', description: 'View product and variant images' },
  { key: 'product_media.create', description: 'Upload product and variant images' },
  { key: 'product_media.update', description: 'Update image alt text and captions' },
  { key: 'product_media.delete', description: 'Delete product and variant images' },
  { key: 'product_media.reorder', description: 'Reorder product and variant images' },
  { key: 'product_media.primary', description: 'Change the primary product or variant image' },
  { key: 'warehouse.read', description: 'View warehouses' },
  { key: 'warehouse.create', description: 'Create warehouses' },
  { key: 'warehouse.update', description: 'Update warehouses' },
  { key: 'warehouse.delete', description: 'Delete (soft-delete) warehouses' },
  { key: 'warehouse.status', description: 'Activate or deactivate warehouses' },
  { key: 'inventory.read', description: 'View inventory, transactions and reservations' },
  { key: 'inventory.adjust', description: 'Initialize and adjust stock quantities' },
  { key: 'inventory.transfer', description: 'Transfer stock between warehouses' },
  { key: 'inventory.reserve', description: 'Reserve and consume stock reservations' },
  { key: 'inventory.release', description: 'Release stock reservations' },
  { key: 'inventory.manage', description: 'Manage stock, warehouses and adjustments' },
  { key: 'orders.manage', description: 'View and manage orders, shipments and returns' },
  { key: 'shipping_method.read', description: 'View shipping methods' },
  { key: 'shipping_method.create', description: 'Create shipping methods' },
  { key: 'shipping_method.update', description: 'Update shipping methods' },
  { key: 'shipping_method.delete', description: 'Delete (soft-delete) shipping methods' },
  { key: 'shipping_method.status', description: 'Activate or deactivate shipping methods' },
  { key: 'order.read', description: 'View orders and their fulfillment status' },
  { key: 'order.status', description: 'Change order fulfillment status (process, ship, deliver, cancel)' },
  { key: 'order.fulfill', description: 'Fulfill an order (consume committed inventory)' },
  { key: 'promotion.read', description: 'View promotions' },
  { key: 'promotion.create', description: 'Create promotions' },
  { key: 'promotion.update', description: 'Update promotions, including targeting and exclusions' },
  { key: 'promotion.delete', description: 'Delete (soft-delete) promotions' },
  { key: 'promotion.status', description: 'Activate or deactivate promotions' },
  { key: 'coupon.read', description: 'View coupons and their usage' },
  { key: 'coupon.create', description: 'Create coupons' },
  { key: 'coupon.update', description: 'Update coupons' },
  { key: 'coupon.delete', description: 'Delete (soft-delete) coupons' },
  { key: 'coupon.status', description: 'Activate or deactivate coupons' },
  { key: 'review.read', description: 'View product reviews and moderation queue' },
  { key: 'review.moderate', description: 'Approve, reject, or hide product reviews' },
  { key: 'review.delete', description: 'Delete (soft-delete) product reviews' },
  { key: 'marketing.manage', description: 'Manage coupons, promotions, banners and campaigns' },
  { key: 'content.manage', description: 'Manage homepage sections, pages, menus and blog' },
  { key: 'reviews.manage', description: 'Moderate product reviews' },
  { key: 'reports.view', description: 'View sales, product, customer and inventory reports' },
  { key: 'notifications.manage', description: 'Manage email/SMS/WhatsApp templates' },
  { key: 'notification.read', description: 'View customer notifications' },
  { key: 'notification.create', description: 'Manually create a notification' },
  { key: 'notification.manage', description: 'Manage notification delivery and failed notifications' },
  { key: 'notification_template.read', description: 'View notification templates' },
  { key: 'notification_template.create', description: 'Create notification templates' },
  { key: 'notification_template.update', description: 'Update notification templates' },
  { key: 'notification_template.delete', description: 'Delete (soft-delete) notification templates' },
  { key: 'notification_template.status', description: 'Activate or deactivate notification templates' },
  { key: 'notification_preference.read', description: "View a customer's own notification preferences" },
  { key: 'notification_preference.update', description: "Update a customer's own notification preferences" },
  { key: 'return.read', description: 'View return requests' },
  { key: 'return.create', description: 'Create a return request on behalf of a customer' },
  { key: 'return.update', description: 'Change a return request status (generic transitions)' },
  { key: 'return.approve', description: 'Approve a return request' },
  { key: 'return.reject', description: 'Reject a return request' },
  { key: 'return.receive', description: 'Mark a return request as received' },
  { key: 'return.inspect', description: 'Record item condition/disposition for a received return' },
  { key: 'refund.read', description: 'View refunds' },
  { key: 'refund.create', description: 'Initiate a refund for a return request' },
  { key: 'refund.manage', description: 'Manage refund recovery/reconciliation' },
  { key: 'analytics.read', description: 'View the analytics dashboard overview and reconciliation report' },
  { key: 'analytics.sales', description: 'View sales analytics' },
  { key: 'analytics.orders', description: 'View order analytics' },
  { key: 'analytics.products', description: 'View product performance analytics' },
  { key: 'analytics.customers', description: 'View customer analytics' },
  { key: 'analytics.inventory', description: 'View inventory analytics' },
  { key: 'analytics.payments', description: 'View payment analytics' },
  { key: 'analytics.refunds', description: 'View refund analytics' },
  { key: 'analytics.returns', description: 'View return analytics' },
  { key: 'analytics.promotions', description: 'View coupon/promotion analytics' },
  { key: 'diagnostics.read', description: 'View operational diagnostics (outbox/notification backlog, metrics snapshot)' },
  { key: 'users.manage', description: 'View and manage store users' },
  { key: 'roles.manage', description: 'View and manage roles and permissions' },
  { key: 'settings.store.manage', description: 'Manage store configuration and branding' },
  { key: 'settings.system.manage', description: 'Manage system-level settings' },
  { key: 'audit.view', description: 'View audit logs' },
  { key: 'homepage_slides.manage', description: 'Manage the customer storefront homepage slider/banner' },
  { key: 'blog.manage', description: 'Manage blog posts' },
  { key: 'contact_message.read', description: 'View contact form submissions' },
];

async function main() {
  const store = await prisma.store.upsert({
    where: { slug: STORE_SLUG },
    update: {},
    create: { slug: STORE_SLUG, name: 'Peshani', isActive: true },
  });

  const defaultSettings: Record<string, string> = {
    storeName: 'Peshani',
    storeDescription: 'Modern online shopping platform',
    currency: process.env.DEFAULT_STORE_CURRENCY ?? 'INR',
    currencySymbol: '₹',
    country: 'India',
    timezone: process.env.DEFAULT_STORE_TIMEZONE ?? 'Asia/Kolkata',
    defaultLanguage: 'English',
    supportEmail: 'support@peshani.example',
    supportPhone: '',
    // Phase 10 - configurable per-store return window; ReturnEligibilityService
    // falls back to 14 if this setting is ever absent/invalid, so this seed
    // value merely makes the store's own configured policy explicit and
    // editable via the existing /store-settings admin UI.
    RETURN_WINDOW_DAYS: '14',
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId: store.id, key } },
      update: {},
      create: { storeId: store.id, key, value },
    });
  }

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }

  const allPermissions = await prisma.permission.findMany();

  const superAdminRole = await prisma.role.upsert({
    where: { storeId_name: { storeId: store.id, name: 'SUPER_ADMIN' } },
    update: {},
    create: { storeId: store.id, name: 'SUPER_ADMIN', isSystem: true },
  });

  await prisma.role.upsert({
    where: { storeId_name: { storeId: store.id, name: 'CUSTOMER' } },
    update: {},
    create: { storeId: store.id, name: 'CUSTOMER', isSystem: true },
  });

  for (const permission of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdminRole.id, permissionId: permission.id } },
      update: {},
      create: { roleId: superAdminRole.id, permissionId: permission.id },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const adminUser = await prisma.user.upsert({
    where: { storeId_email: { storeId: store.id, email: adminEmail } },
    update: {},
    create: {
      storeId: store.id,
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword),
      firstName: 'Peshani',
      lastName: 'Admin',
      type: UserType.ADMIN,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: superAdminRole.id },
  });

  // Phase 7 - minimal example promotion/coupon, store-wide (no targeting),
  // so a fresh checkout of the seeded environment has something to try.
  const welcomePromotion = await prisma.promotion.upsert({
    where: { id: 'seed-welcome-promotion' },
    update: {},
    create: {
      id: 'seed-welcome-promotion',
      storeId: store.id,
      name: 'New Customer 10%',
      description: '10% off for new customers, store-wide',
      discountType: 'PERCENTAGE',
      value: '10.00',
      maximumDiscountAmount: '500.00',
      isActive: true,
    },
  });
  await prisma.coupon.upsert({
    where: { storeId_normalizedCode: { storeId: store.id, normalizedCode: 'WELCOME10' } },
    update: {},
    create: {
      storeId: store.id,
      promotionId: welcomePromotion.id,
      code: 'WELCOME10',
      normalizedCode: 'WELCOME10',
      isActive: true,
    },
  });

  console.log('Seed complete.');
  console.log(`Store: ${store.name} (${store.slug})`);
  console.log(`Super admin login: ${adminEmail} / ${adminPassword} (change this password immediately)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
