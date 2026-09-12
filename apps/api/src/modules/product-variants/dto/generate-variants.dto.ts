import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { AxesInputDto } from './variant-axis.dto';
import { IsMoneyString, IsWeightString } from '../../../common/validators/decimal.validator';

class GenerateVariantDefaultsDto {
  @IsOptional()
  @IsMoneyString()
  price?: string;

  @IsOptional()
  @IsMoneyString()
  costPrice?: string;

  @IsOptional()
  @IsWeightString()
  weight?: string;
}

export class GenerateVariantsDto extends AxesInputDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GenerateVariantDefaultsDto)
  defaults?: GenerateVariantDefaultsDto;
}
