import {
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CompetitorDto {
  // identifier of a provider that implements publicProfile (bluesky, mastodon)
  @IsString()
  @IsDefined()
  provider: string;

  @IsString()
  @IsDefined()
  @MinLength(2)
  @MaxLength(200)
  handle: string;
}

export class InspirationQueryDto {
  @IsString()
  @IsOptional()
  provider?: string;
}
