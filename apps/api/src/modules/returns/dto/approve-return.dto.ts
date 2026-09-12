import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminComment?: string;
}
