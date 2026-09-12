import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReturnsModule } from '../returns/returns.module';
import { OrderService } from './order.service';
import { OrderStatusService } from './order-status.service';
import { OrderController } from './order.controller';
import { AdminOrdersController } from './admin-orders.controller';

@Module({
  imports: [InventoryModule, PromotionsModule, NotificationsModule, ReturnsModule],
  controllers: [OrderController, AdminOrdersController],
  providers: [OrderService, OrderStatusService],
  exports: [OrderService, OrderStatusService],
})
export class OrdersModule {}
