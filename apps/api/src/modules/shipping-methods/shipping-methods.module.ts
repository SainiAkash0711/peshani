import { Module } from '@nestjs/common';
import { StoreSettingsModule } from '../store-settings/store-settings.module';
import { ShippingMethodsService } from './shipping-methods.service';
import { ShippingMethodsController } from './shipping-methods.controller';

@Module({
  imports: [StoreSettingsModule],
  controllers: [ShippingMethodsController],
  providers: [ShippingMethodsService],
  exports: [ShippingMethodsService],
})
export class ShippingMethodsModule {}
