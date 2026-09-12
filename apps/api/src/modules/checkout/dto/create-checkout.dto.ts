import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AddressDto } from './address.dto';

export class CreateCheckoutDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  billingAddress!: AddressDto;

  // Defaults to billingAddress when omitted (see CheckoutService) - most
  // customers ship to the same address they bill to.
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress?: AddressDto;

  // Phase 6: an id only - price/eligibility are looked up server-side from
  // this id (never trusted from the client, see Phase 6 §6/§7). Optional so
  // every pre-Phase-6 checkout request (no shipping charge) remains valid.
  @IsOptional()
  @IsUUID()
  shippingMethodId?: string;

  // Phase 7 - a code only - eligibility/amount are looked up and computed
  // server-side (never trusted from the client, §3). Optional; omitting it
  // preserves every pre-Phase-7 checkout exactly (discountAmount 0).
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  couponCode?: string;
}
