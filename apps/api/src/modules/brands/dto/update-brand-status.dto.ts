import { IsBoolean } from 'class-validator';

export class UpdateBrandStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
