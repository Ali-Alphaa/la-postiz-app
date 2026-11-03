import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SwipeStatus } from '@prisma/client';

// the SCAMPER techniques of the swipe file: one rewrite per technique picked
export const SWIPE_TECHNIQUES = [
  {
    key: 'substitute',
    label: 'Substitute',
    hint: 'Replace the main idea, the method that gets the benefit, or the method that avoids the pain point.',
  },
  {
    key: 'combine',
    label: 'Combine',
    hint: 'Merge it with a similar idea or with a personal experience.',
  },
  {
    key: 'adapt',
    label: 'Adapt',
    hint: 'Expand a one-liner into a fuller post, or add the missing piece of the advice.',
  },
  {
    key: 'modify',
    label: 'Modify',
    hint: 'Magnify a pain point, exaggerate it, or move the idea into a different post format.',
  },
  {
    key: 'purpose',
    label: 'Purpose',
    hint: 'Put the idea to another use by angling it at a different part of the audience or benefit.',
  },
  {
    key: 'eliminate',
    label: 'Eliminate',
    hint: 'Strip it down. Remove nuance and words until it is punchy and simple.',
  },
  {
    key: 'reverse',
    label: 'Reverse',
    hint: 'Flip the idea around and say what happens when you do the opposite.',
  },
] as const;

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };

export class SwipeEntryDto {
  @IsString()
  @IsDefined()
  @MaxLength(20000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(20000, { each: true })
  threadParts?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  formatTag?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  topicTags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  whyItWorks?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  collection?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  imagePath?: string;

  @IsOptional()
  @IsBoolean()
  starred?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  notionBlockId?: string;
}

export class ImportSwipeDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SwipeEntryDto)
  entries: SwipeEntryDto[];
}

export class SwipeQueryDto {
  @IsOptional()
  @IsEnum(SwipeStatus)
  status?: SwipeStatus;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  formatTag?: string;

  @IsOptional()
  @IsString()
  collection?: string;

  @IsOptional()
  @IsString()
  starred?: string;
}

export class SwipeStatusDto {
  @IsEnum(SwipeStatus)
  status: SwipeStatus;
}

export class SwipeStarDto {
  @IsBoolean()
  starred: boolean;
}

export class SwipeRepurposeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsIn(SWIPE_TECHNIQUES.map((p) => p.key), { each: true })
  techniques: string[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string;

  // empty: keep the tone of the source post
  @IsOptional()
  @IsString()
  @MaxLength(30)
  voiceHandle?: string;
}

export class SwipeFindDto {
  @IsString()
  @IsDefined()
  @MaxLength(200)
  topic: string;

  @IsOptional()
  @IsIn(['x', 'instagram', 'both'])
  platform?: 'x' | 'instagram' | 'both';

  @IsInt()
  @Min(1)
  @Max(10)
  count: number;
}

export class SwipeLinkDto {
  @IsUrl(URL_OPTIONS)
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  content?: string;
}
