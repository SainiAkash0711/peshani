import { IsString, MaxLength } from 'class-validator';

/**
 * The client submits only Razorpay's own opaque identifiers plus the
 * orderNumber it's paying for - never an amount, currency, or status. See
 * §80: the browser's own claim of "payment successful" is never trusted;
 * PaymentService independently fetches the payment from Razorpay itself.
 */
export class VerifyPaymentDto {
  @IsString()
  @MaxLength(64)
  orderNumber!: string;

  @IsString()
  @MaxLength(64)
  razorpayOrderId!: string;

  @IsString()
  @MaxLength(64)
  razorpayPaymentId!: string;

  @IsString()
  @MaxLength(512)
  razorpaySignature!: string;
}
