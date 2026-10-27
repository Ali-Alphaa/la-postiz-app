import { IsDefined, IsString, MaxLength } from 'class-validator';

export class BestTimeDto {
  // IANA name of the user's timezone (Europe/Paris)
  @IsString()
  @IsDefined()
  @MaxLength(100)
  timezone: string;
}
