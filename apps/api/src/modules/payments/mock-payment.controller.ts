import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AppConfig } from '../../config/configuration';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { MockPaymentService } from './providers/mock-payment.service';

class MockPayDto {
  @IsString()
  @MaxLength(64)
  orderNumber!: string;

  @IsString()
  @MaxLength(64)
  razorpayOrderId!: string;
}

@ApiTags('payments')
@Controller('payments/mock')
export class MockPaymentController {
  constructor(
    private readonly mockPayments: MockPaymentService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  // Needs a signed-in customer, and does not exist at all unless PAYMENT_MODE=mock.
  @Post('pay')
  pay(@CurrentUser() user: AuthenticatedUser, @Body() dto: MockPayDto) {
    if (this.configService.get('paymentMode', { infer: true }) !== 'mock') {
      throw new NotFoundException();
    }
    return this.mockPayments.issuePaymentCallback(user.storeId, user.userId, dto.orderNumber, dto.razorpayOrderId);
  }
}
