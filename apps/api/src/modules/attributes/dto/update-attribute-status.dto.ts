import { IsBoolean } from 'class-validator';

export class UpdateAttributeStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
