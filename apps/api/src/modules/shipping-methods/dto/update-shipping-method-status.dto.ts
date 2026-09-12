import { IsBoolean } from 'class-validator';

export class UpdateShippingMethodStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
