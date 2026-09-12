import { IsString, MaxLength } from 'class-validator';

export class UpdateStoreSettingDto {
  @IsString()
  @MaxLength(100)
  key!: string;

  @IsString()
  @MaxLength(5000)
  value!: string;
}
