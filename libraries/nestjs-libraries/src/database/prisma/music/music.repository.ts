import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  MusicTrackDto,
  MusicUploadDto,
} from '@gitroom/nestjs-libraries/dtos/music/music.dto';

const TRACK_SELECT = {
  id: true,
  title: true,
  artist: true,
  licence: true,
  path: true,
  duration: true,
  createdAt: true,
};

@Injectable()
export class MusicRepository {
  constructor(private _track: PrismaRepository<'musicTrack'>) {}

  getTracks(orgId: string) {
    return this._track.model.musicTrack.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: TRACK_SELECT,
    });
  }

  createTrack(orgId: string, path: string, body: MusicUploadDto) {
    return this._track.model.musicTrack.create({
      data: {
        organizationId: orgId,
        path,
        title: body.title,
        artist: body.artist || null,
        licence: body.licence || null,
        duration: body.duration ?? null,
      },
      select: TRACK_SELECT,
    });
  }

  updateTrack(orgId: string, id: string, body: MusicTrackDto) {
    return this._track.model.musicTrack.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: {
        title: body.title,
        artist: body.artist || null,
        licence: body.licence || null,
      },
    });
  }

  deleteTrack(orgId: string, id: string) {
    return this._track.model.musicTrack.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
