import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const INBOX_STATUSES = ['OPEN', 'REPLIED', 'DONE'] as const;

export class InboxQueryDto {
  @IsOptional()
  @IsIn(INBOX_STATUSES)
  status?: (typeof INBOX_STATUSES)[number];

  @IsOptional()
  @IsString()
  integrationId?: string;
}

export class InboxReplyDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}

export class InboxStatusDto {
  @IsIn(INBOX_STATUSES)
  status: (typeof INBOX_STATUSES)[number];
}

export class DmAutomationDto {
  @IsString()
  @IsDefined()
  integrationId: string;

  // empty: comments on any post of the channel
  @IsOptional()
  @IsString()
  postId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  keyword: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  dmText: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  publicReply?: string;

  @IsBoolean()
  enabled: boolean;
}
