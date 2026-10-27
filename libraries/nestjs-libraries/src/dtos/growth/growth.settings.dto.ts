import {
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class GrowthSettingsDto {
  @IsBoolean()
  @IsDefined()
  utmEnabled: boolean;

  // {{provider}} is replaced with the provider identifier (x, linkedin-page...)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  utmSource?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  utmMedium?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  utmCampaign?: string;
}
