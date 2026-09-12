import { IsBoolean } from 'class-validator';

export class UpdateWarehouseStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
