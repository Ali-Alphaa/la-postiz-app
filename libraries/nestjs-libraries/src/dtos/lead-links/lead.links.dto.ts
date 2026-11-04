import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const LEAD_TONES = ['formal', 'balanced', 'casual'] as const;
export const MAX_LEAD_VERSIONS = 5;

// the messages every new lead magnet starts with
export const LEAD_SLOTS: ReadonlyArray<{
  label: string;
  tone: (typeof LEAD_TONES)[number];
}> = [
  { label: 'Professional or business enquiry', tone: 'formal' },
  { label: 'Someone asks for evidence or how it works', tone: 'formal' },
  { label: 'A serious trader asks a technical question', tone: 'formal' },
  { label: 'A beginner asks where to start', tone: 'balanced' },
  { label: 'Someone has just had a loss or a bad run', tone: 'balanced' },
  { label: 'Someone asks for a resource recommendation', tone: 'balanced' },
  { label: 'Following up on your own post', tone: 'balanced' },
  { label: 'Friendly reply in a thread', tone: 'casual' },
  { label: 'Someone joking about losing money', tone: 'casual' },
  { label: 'Lighthearted one-liner', tone: 'casual' },
];

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

export class LeadMagnetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @IsUrl(URL_OPTIONS)
  url: string;

  // posts only accept these image types
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @Matches(/\.(png|jpe?g|gif|webp)(\?.*)?$/i, {
    message: 'The cover must be a png, jpg, gif or webp image',
  })
  coverUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @Matches(/^[a-z0-9]{2,8}$/)
  code: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class LeadVersionDto {
  @IsString()
  @MaxLength(40)
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @IsString()
  @Matches(/\S/, { message: 'A copy needs some text' })
  @MaxLength(2000)
  text: string;
}

export class LeadMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @IsIn(LEAD_TONES)
  tone: (typeof LEAD_TONES)[number];

  // only taken while the message has no original yet
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  original?: string;

  @IsArray()
  @ArrayMaxSize(MAX_LEAD_VERSIONS)
  @ValidateNested({ each: true })
  @Type(() => LeadVersionDto)
  versions: LeadVersionDto[];

  @IsString()
  @MaxLength(40)
  defaultVersion: string;
}
