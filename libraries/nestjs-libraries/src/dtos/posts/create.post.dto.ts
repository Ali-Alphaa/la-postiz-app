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
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  allProviders,
  type AllProvidersSettings,
  EmptySettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { ValidContent } from '@gitroom/helpers/utils/valid.images';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';

export class Integration {
  @IsDefined()
  @IsString()
  id: string;
}

export class PostContent {
  @IsDefined()
  @IsString()
  @Validate(ValidContent)
  @Transform(({ value }) => sanitizePostContent(value))
  content: string;

  @IsOptional()
  @IsString()
  id: string;

  @IsOptional()
  @IsNumber()
  delay: number;

  @IsArray()
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  image: MediaDto[];
}

export class Post {
  type?: string;

  @IsDefined()
  @Type(() => Integration)
  @ValidateNested()
  integration: Integration;

  @IsDefined()
  @ArrayMinSize(1)
  @IsArray()
  @Type(() => PostContent)
  @ValidateNested({ each: true })
  value: PostContent[];

  @IsOptional()
  @IsString()
  group: string;

  // a channel that keeps a date of its own, the others use the post date
  @IsOptional()
  @IsDateString()
  date?: string;

  @ValidateIf((o) => o.type !== 'draft')
  @ValidateNested()
  @Type(() => EmptySettings, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: '__type',
      subTypes: allProviders(EmptySettings),
    },
  })
  settings: AllProvidersSettings;
}

class Tags {
  @IsDefined()
  @IsString()
  value: string;

  @IsDefined()
  @IsString()
  label: string;
}

// one send of a same-day repeat, with the text that was approved for it
class SeriesSlot {
  @IsDefined()
  @IsDateString()
  date: string;

  @IsDefined()
  @IsString()
  content: string;
}

// a post that goes out every N minutes or hours during one day: every slot
// becomes its own scheduled post
class Series {
  @IsInt()
  @Min(15)
  @Max(1440)
  intervalMinutes: number;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => SeriesSlot)
  slots: SeriesSlot[];
}

export class SeriesVariationsDto {
  @IsString()
  text: string;

  @IsInt()
  @Min(2)
  @Max(24)
  count: number;

  @IsOptional()
  @IsString()
  integrationId?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  maxLength?: number;
}

export class CreatePostDto {
  @IsDefined()
  @IsIn(['draft', 'schedule', 'now', 'update'])
  type: 'draft' | 'schedule' | 'now' | 'update';

  @IsOptional()
  @IsString()
  order?: string;

  @IsDefined()
  @IsBoolean()
  shortLink: boolean;

  @IsOptional()
  @IsNumber()
  inter?: number;

  // how many times a repeating post goes out in total, null keeps repeating
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(365)
  repeatTimes?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => Series)
  series?: Series;

  // explicit opt-in to publish an already-PUBLISHED post again; without it a
  // schedule/now save targeting a published post is rejected
  @IsOptional()
  @IsBoolean()
  republish?: boolean;

  @IsDefined()
  @IsDateString()
  date: string;

  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  tags: Tags[];

  @IsDefined()
  @Type(() => Post)
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  posts: Post[];
}
