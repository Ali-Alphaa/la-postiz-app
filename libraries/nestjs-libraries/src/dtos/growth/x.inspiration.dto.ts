import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const X_MEDIA_TYPES = ['photo', 'video', 'none'] as const;
export const X_HOOK_TYPES = [
  'question',
  'contrarian',
  'story',
  'list',
  'stat',
  'how-to',
  'announcement',
  'other',
] as const;
export const X_FORMATS = [
  'one-liner',
  'thread-starter',
  'list',
  'long-form',
  'media-led',
] as const;

// handles are 1-15 letters, numbers and underscores
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

// A tweet as the browser extension reads it from x.com
export class XCapturedTweetDto {
  @IsString()
  @Matches(/^\d{1,30}$/)
  id: string;

  @IsString()
  @MaxLength(300)
  url: string;

  @IsString()
  @Matches(HANDLE)
  authorHandle: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  authorName?: string;

  @IsString()
  @MaxLength(10000)
  text: string;

  @IsInt()
  @Min(0)
  likes: number;

  @IsInt()
  @Min(0)
  reposts: number;

  @IsInt()
  @Min(0)
  replies: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  views?: number | null;

  @IsIn(X_MEDIA_TYPES)
  mediaType: (typeof X_MEDIA_TYPES)[number];

  @IsDateString()
  @IsOptional()
  postedAt?: string | null;

  @IsBoolean()
  @IsOptional()
  isReply?: boolean;

  @IsBoolean()
  @IsOptional()
  isQuote?: boolean;

  @IsBoolean()
  @IsOptional()
  own?: boolean;

  // saved with the "Save to Postiz" button: kept whatever its likes
  @IsBoolean()
  @IsOptional()
  manual?: boolean;
}

export class XCaptureDto {
  @IsString()
  @IsOptional()
  @Matches(HANDLE)
  ownHandle?: string;

  // minutes, as Date.getTimezoneOffset() of the browser: used for "today"
  @IsInt()
  @IsOptional()
  @Min(-840)
  @Max(840)
  utcOffset?: number;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => XCapturedTweetDto)
  tweets: XCapturedTweetDto[];
}

export class XLibraryQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 1;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  topic?: string;

  @IsOptional()
  @IsIn(X_HOOK_TYPES)
  hookType?: string;

  @IsOptional()
  @IsIn(X_FORMATS)
  format?: string;

  // on: trading & markets or not analyzed yet, off: off-niche only
  @IsOptional()
  @IsIn(['on', 'off', 'all'])
  niche?: 'on' | 'off' | 'all' = 'on';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseFloat(value))
  minRatio?: number;

  @IsOptional()
  @IsIn(['auto', 'manual', 'fetch'])
  source?: 'auto' | 'manual' | 'fetch';

  @IsOptional()
  @IsIn(['ratio', 'likes', 'recent'])
  sort?: 'ratio' | 'likes' | 'recent' = 'ratio';
}

export class XVoiceDto {
  @IsString()
  @IsDefined()
  @MaxLength(20000)
  styleGuide: string;
}

export class XRewriteDto {
  @IsIn(['single', 'thread'])
  format: 'single' | 'thread';

  // the X account whose voice to write in; default: the account of the
  // channel the post goes to, else the most recent voice
  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9_]{1,15}$/)
  voiceHandle?: string;

  @IsOptional()
  @IsString()
  integrationId?: string;
}

// a tweet added from the Postiz page by its link
export class XSaveUrlDto {
  @IsString()
  @IsDefined()
  @MaxLength(300)
  url: string;

  // used when X doesn't answer for this tweet
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  text?: string;
}

export class XRepurposeDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tweetIds: string[];

  @IsIn(['single', 'thread'])
  format: 'single' | 'thread';

  // write in the voice of the user instead of the tone of the source
  @IsBoolean()
  @IsOptional()
  useMyVoice?: boolean;

  // the X account whose voice to write in; default: the account of the
  // channel the post goes to, else the most recent voice
  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9_]{1,15}$/)
  voiceHandle?: string;

  @IsOptional()
  @IsString()
  integrationId?: string;
}

export class XRepurposePostDto {
  @IsInt()
  @Min(0)
  @Max(4)
  index: number;

  @IsString()
  @IsDefined()
  integrationId: string;

  // the variation as the user edited it, a thread has more than one post
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(25000, { each: true })
  posts: string[];

  @IsIn(['now', 'schedule'])
  type: 'now' | 'schedule';

  @ValidateIf((o) => o.type === 'schedule')
  @IsDateString()
  date?: string;
}

// the X fetcher (optional, see x-fetcher/NOTICE.md)
export class XFetchUserDto {
  @IsString()
  @IsDefined()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/^@/, '') : value
  )
  @Matches(HANDLE)
  handle: string;

  @IsInt()
  @Min(1)
  @Max(100)
  limit: number;

  @IsBoolean()
  @IsOptional()
  includeReplies?: boolean;
}

export class XFetchSearchDto {
  @IsString()
  @IsDefined()
  @MaxLength(300)
  query: string;

  @IsIn(['latest', 'top'])
  mode: 'latest' | 'top';

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(10000000)
  minLikes?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  limit: number;
}

export class XFetchSaveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(/^\d{1,30}$/, { each: true })
  tweetIds: string[];
}

// posts the extension puts into X's own scheduler (X Premium)
export const X_NATIVE_STATUSES = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'cancelled',
] as const;
export type XNativeStatus = (typeof X_NATIVE_STATUSES)[number];

export class XNativeDto {
  @IsString()
  @IsDefined()
  @MaxLength(2000)
  text: string;

  @IsDateString()
  scheduledAt: string;

  // the X account to schedule it on (empty: any)
  @IsOptional()
  @IsString()
  @Matches(/^@?[A-Za-z0-9_]{1,15}$/)
  handle?: string;
}

export class XNativeUpdateDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  text?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;
}

export class XNativeListDto {
  @IsOptional()
  @IsIn(X_NATIVE_STATUSES)
  status?: XNativeStatus;
}

export class XNativeQueueDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @Transform(({ value }) => parseInt(value, 10))
  days?: number = 14;
}

export class XNativeResultDto {
  @IsBoolean()
  ok: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  error?: string;
}

export class XRepurposeNativeDto extends XNativeDto {
  @IsInt()
  @Min(0)
  @Max(4)
  index: number;
}

export type XHookType = (typeof X_HOOK_TYPES)[number];
export type XFormat = (typeof X_FORMATS)[number];
