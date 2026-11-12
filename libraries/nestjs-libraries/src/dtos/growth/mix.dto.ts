import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// What a post can be labelled with. Format comes from the media of the post.
export const MIX_FORMATS = ['text', 'thread', 'image', 'carousel', 'video'];
export const MIX_PILLARS = [
  'receipts',
  'rulebook',
  'risk_psychology',
  'student_stories',
  'behind_scenes',
  'offer',
  'other',
];
export const MIX_CTAS = ['none', 'engage', 'comment_dm', 'link'];
export const MIX_KINDS = ['format', 'pillar', 'cta'];

export class MixDayQueryDto {
  // YYYY-MM-DD in the timezone of the schedule
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

export class MixLabelDto {
  @IsOptional()
  @IsIn(MIX_FORMATS)
  format?: string;

  @IsOptional()
  @IsIn(MIX_PILLARS)
  pillar?: string;

  @IsOptional()
  @IsIn(MIX_CTAS)
  cta?: string;
}

export class MixTargetDto {
  @IsIn(MIX_KINDS)
  kind: string;

  @IsString()
  @MaxLength(40)
  value: string;

  @IsInt()
  @Min(0)
  @Max(200)
  perWeek: number;
}

export class MixTargetsDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => MixTargetDto)
  @IsDefined()
  targets: MixTargetDto[];
}

export class MixMoveDto {
  // ISO date of the new time
  @IsString()
  @MaxLength(40)
  date: string;
}
