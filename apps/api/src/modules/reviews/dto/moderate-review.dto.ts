import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const MODERATION_TARGETS = ['APPROVED', 'REJECTED', 'HIDDEN'] as const;

export class ModerateReviewDto {
  @IsIn(MODERATION_TARGETS)
  status!: (typeof MODERATION_TARGETS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  moderationNote?: string;
}
