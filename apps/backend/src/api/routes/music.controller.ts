import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { MusicService } from '@gitroom/nestjs-libraries/database/prisma/music/music.service';
import {
  MusicTrackDto,
  MusicUploadDto,
} from '@gitroom/nestjs-libraries/dtos/music/music.dto';
import { streamUploadOptions } from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { MUSIC_ALLOWED_MIME } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@ApiTags('Music')
@Controller('/music')
export class MusicController {
  private storage = UploadFactory.createStorage();
  constructor(private _musicService: MusicService) {}

  @Get('/')
  getTracks(@GetOrgFromRequest() org: Organization) {
    return this._musicService.getTracks(org.id);
  }

  @Post('/')
  @UseInterceptors(
    FileInterceptor('file', streamUploadOptions(MUSIC_ALLOWED_MIME))
  )
  async createTrack(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File,
    // checked here: the file is already stored by the time a pipe would run
    @Body() raw: Record<string, unknown>
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const body = plainToInstance(MusicUploadDto, raw);
    const errors = await validate(body, { whitelist: true });
    if (errors.length) {
      await this.storage.removeFile(file.path).catch(() => null);
      throw new BadRequestException('Invalid track details');
    }
    return this._musicService.createTrack(org.id, file.path, body);
  }

  @Put('/:id')
  updateTrack(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: MusicTrackDto
  ) {
    return this._musicService.updateTrack(org.id, id, body);
  }

  @Delete('/:id')
  deleteTrack(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._musicService.deleteTrack(org.id, id);
  }
}
