import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  LEAD_SLOTS,
  LeadMagnetDto,
  LeadMessageDto,
} from '@gitroom/nestjs-libraries/dtos/lead-links/lead.links.dto';

@Injectable()
export class LeadLinksRepository {
  constructor(
    private _magnet: PrismaRepository<'leadMagnet'>,
    private _message: PrismaRepository<'leadMessage'>
  ) {}

  getMagnets(orgId: string) {
    return this._magnet.model.leadMagnet.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      include: { messages: { orderBy: { position: 'asc' } } },
    });
  }

  getMagnet(orgId: string, id: string) {
    return this._magnet.model.leadMagnet.findFirst({
      where: { id, organizationId: orgId },
      include: { messages: { orderBy: { position: 'asc' } } },
    });
  }

  getMagnetByCode(orgId: string, code: string) {
    return this._magnet.model.leadMagnet.findUnique({
      where: { organizationId_code: { organizationId: orgId, code } },
      select: { id: true },
    });
  }

  createMagnet(orgId: string, body: LeadMagnetDto) {
    return this._magnet.model.leadMagnet.create({
      data: {
        organizationId: orgId,
        title: body.title,
        url: body.url,
        coverUrl: body.coverUrl || null,
        description: body.description || null,
        code: body.code,
        messages: {
          create: LEAD_SLOTS.map((slot, index) => ({
            position: index + 1,
            label: slot.label,
            tone: slot.tone,
          })),
        },
      },
      select: { id: true },
    });
  }

  // the code stays: it is in links already shared and in the revenue report
  updateMagnet(id: string, body: LeadMagnetDto, coverChanged: boolean) {
    return this._magnet.model.leadMagnet.update({
      where: { id },
      data: {
        title: body.title,
        url: body.url,
        coverUrl: body.coverUrl || null,
        ...(coverChanged ? { coverMediaId: null } : {}),
        description: body.description || null,
        archivedAt: body.archived ? new Date() : null,
      },
      select: { id: true },
    });
  }

  saveCoverMedia(id: string, coverMediaId: string) {
    return this._magnet.model.leadMagnet.update({
      where: { id },
      data: { coverMediaId },
      select: { id: true },
    });
  }

  getMessage(orgId: string, id: string) {
    return this._message.model.leadMessage.findFirst({
      where: { id, magnet: { organizationId: orgId } },
      include: { magnet: true },
    });
  }

  updateMessage(id: string, original: string, body: LeadMessageDto) {
    return this._message.model.leadMessage.update({
      where: { id },
      data: {
        label: body.label,
        tone: body.tone,
        original,
        versions: body.versions as any,
        defaultVersion: body.defaultVersion,
      },
      select: { id: true },
    });
  }

  // only while it is empty: an original is never replaced
  saveDraft(id: string, original: string) {
    return this._message.model.leadMessage.updateMany({
      where: { id, original: '' },
      data: { original, aiDrafted: true },
    });
  }

  saveVersions(id: string, versions: unknown[]) {
    return this._message.model.leadMessage.update({
      where: { id },
      data: { versions: versions as any },
      select: { id: true },
    });
  }

  // what the revenue report needs to name a message from its tag
  getReportMessages(orgId: string) {
    return this._message.model.leadMessage.findMany({
      where: { magnet: { organizationId: orgId } },
      select: {
        position: true,
        label: true,
        tone: true,
        magnet: { select: { code: true, title: true } },
      },
    });
  }
}
