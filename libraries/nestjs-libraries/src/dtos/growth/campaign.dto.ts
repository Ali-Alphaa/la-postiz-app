import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
} from 'class-validator';

export const CAMPAIGN_PLAYBOOKS = ['lead_magnet_7', 'lead_magnet_14'];

export const CAMPAIGN_PROFILES = ['trading', 'web_studio'];

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

  // the playbook sets the length, this is only read when there is no playbook
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(21)
  days?: number;

  @IsOptional()
  @IsIn(CAMPAIGN_PLAYBOOKS)
  playbook?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_PROFILES)
  profile?: string;

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

export class CampaignDuplicateDto {
  // YYYY-MM-DD in UK time
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}
