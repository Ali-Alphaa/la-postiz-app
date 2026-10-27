import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AbVariantDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  content: string;

  // when empty, the variant goes to the next free posting slot of the channel
  @IsDateString()
  @IsOptional()
  date?: string;
}

export class AbExperimentDto {
  @IsString()
  @IsDefined()
  integrationId: string;

  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  // hours after the last variant is published before the winner is picked
  @IsInt()
  @Min(1)
  @Max(720)
  evaluationHours: number;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AbVariantDto)
  variants: AbVariantDto[];
}
