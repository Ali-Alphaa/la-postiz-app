import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CampaignDto {
  @IsString()
  @IsDefined()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  goal?: string;

  // a lead magnet of the Lead Links page, its link goes into the offer posts
  @IsString()
  @IsDefined()
  leadMagnetId: string;

  // YYYY-MM-DD in UK time
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(21)
  days: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  integrationIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  tone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CampaignPostDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  // ISO date of the new time
  @IsOptional()
  @IsString()
  @MaxLength(40)
  publishAt?: string;
}
