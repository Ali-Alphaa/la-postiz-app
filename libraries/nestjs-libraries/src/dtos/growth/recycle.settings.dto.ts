import { IsBoolean, IsDefined, IsInt, Max, Min } from 'class-validator';

export class RecycleSettingsDto {
  @IsBoolean()
  @IsDefined()
  enabled: boolean;

  // only posts older than this are recycled
  @IsInt()
  @Min(7)
  @Max(3650)
  minAgeDays: number;

  // days between two recycles of the same post
  @IsInt()
  @Min(7)
  @Max(3650)
  minGapDays: number;

  @IsInt()
  @Min(1)
  @Max(14)
  postsPerWeek: number;

  // only posts in this engagement percentile of the channel are recycled
  @IsInt()
  @Min(50)
  @Max(99)
  percentile: number;
}
