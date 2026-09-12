import { IsBoolean } from 'class-validator';

export class UpdateAttributeValueStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
