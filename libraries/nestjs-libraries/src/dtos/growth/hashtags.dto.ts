import {
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class HashtagsQueryDto {
  @IsString()
  @IsOptional()
  integrationId?: string;
}

export class AiHashtagsDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(10000)
  content: string;

  @IsString()
  @IsOptional()
  integrationId?: string;
}
