import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MusicTrackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  artist?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  licence?: string;
}

// an upload also sends the length the browser read from the file
export class MusicUploadDto extends MusicTrackDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3600)
  duration?: number;
}
