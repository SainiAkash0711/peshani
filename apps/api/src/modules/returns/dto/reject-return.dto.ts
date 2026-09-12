import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminComment?: string;
}
