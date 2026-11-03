import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

export class BulkRowDto {
  @IsString()
  @IsDefined()
  integrationId: string;

  @IsString()
  @IsDefined()
  date: string;

  @IsString()
  @IsDefined()
  @MaxLength(20000)
  content: string;
}

export class BulkScheduleDto {
  @IsIn(['draft', 'schedule'])
  type: 'draft' | 'schedule';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkRowDto)
  rows: BulkRowDto[];
}

export class BrandKitDto {
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  background: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  text: string;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accent: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  handle?: string;
}

export class ConversionDto {
  @IsIn(['lead', 'sale'])
  type: 'lead' | 'sale';

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmContent?: string;

  // sent again it updates the same conversion. Never send a raw email here.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalId?: string;
}

export class RevenueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class BioLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  key?: string;

  @IsString()
  @IsDefined()
  @MaxLength(80)
  title: string;

  @IsUrl(URL_OPTIONS)
  url: string;
}

export class BioPageDto {
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/)
  slug: string;

  @IsString()
  @IsDefined()
  @MaxLength(80)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  avatar?: string;

  @IsBoolean()
  enabled: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BioLinkDto)
  links: BioLinkDto[];
}
