import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postalCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  country!: string;
}
