import { Injectable } from '@nestjs/common';
import { MusicRepository } from '@gitroom/nestjs-libraries/database/prisma/music/music.repository';
import {
  MusicTrackDto,
  MusicUploadDto,
} from '@gitroom/nestjs-libraries/dtos/music/music.dto';

@Injectable()
export class MusicService {
  constructor(private _musicRepository: MusicRepository) {}

  getTracks(orgId: string) {
    return this._musicRepository.getTracks(orgId);
  }

  createTrack(orgId: string, path: string, body: MusicUploadDto) {
    return this._musicRepository.createTrack(orgId, path, body);
  }

  async updateTrack(orgId: string, id: string, body: MusicTrackDto) {
    const { count } = await this._musicRepository.updateTrack(orgId, id, body);
    return { updated: count > 0 };
  }

  // the file stays in storage, like a deleted media library item
  async deleteTrack(orgId: string, id: string) {
    const { count } = await this._musicRepository.deleteTrack(orgId, id);
    return { deleted: count > 0 };
  }
}
