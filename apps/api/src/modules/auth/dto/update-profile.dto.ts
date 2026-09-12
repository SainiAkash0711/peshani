import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export enum GenderDto {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
  PREFER_NOT_TO_SAY = 'PREFER_NOT_TO_SAY',
}

// A single saved profile address (not a multi-address book) - field names
// mirror checkout/dto/address.dto.ts's AddressDto for consistency, but every
// field here is optional since a profile address is filled in incrementally,
// unlike a checkout address which must be complete to place an order.
export class ProfileAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(GenderDto)
  gender?: GenderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileAddressDto)
  address?: ProfileAddressDto;
}
