import { IsBoolean } from 'class-validator';

export class SetTemplateStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
