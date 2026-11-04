import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeadLinksRepository } from '@gitroom/nestjs-libraries/database/prisma/lead-links/lead.links.repository';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { XVoiceService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.service';
import {
  LeadMagnetDto,
  LeadMessageDto,
  MAX_LEAD_VERSIONS,
} from '@gitroom/nestjs-libraries/dtos/lead-links/lead.links.dto';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

@Injectable()
export class LeadLinksService {
  constructor(
    private _repository: LeadLinksRepository,
    private _anthropicService: AnthropicService,
    private _xVoiceService: XVoiceService,
    private _mediaService: MediaService
  ) {}

  getMagnets(orgId: string) {
    return this._repository.getMagnets(orgId);
  }

  private async magnetOrFail(orgId: string, id: string) {
    const magnet = await this._repository.getMagnet(orgId, id);
    if (!magnet) {
      throw new NotFoundException('Lead magnet not found');
    }
    return magnet;
  }

  private async messageOrFail(orgId: string, id: string) {
    const message = await this._repository.getMessage(orgId, id);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  async createMagnet(orgId: string, body: LeadMagnetDto) {
    if (await this._repository.getMagnetByCode(orgId, body.code)) {
      throw new ConflictException('This short code is already used');
    }
    return this._repository.createMagnet(orgId, body);
  }

  async updateMagnet(orgId: string, id: string, body: LeadMagnetDto) {
    const magnet = await this.magnetOrFail(orgId, id);
    return this._repository.updateMagnet(
      id,
      body,
      magnet.coverUrl !== (body.coverUrl || null)
    );
  }

  // posts attach media library rows, one is kept per cover
  async coverMedia(orgId: string, id: string) {
    const magnet = await this.magnetOrFail(orgId, id);
    if (!magnet.coverUrl) {
      throw new BadRequestException('This lead magnet has no cover');
    }
    if (magnet.coverMediaId) {
      return { id: magnet.coverMediaId, path: magnet.coverUrl };
    }
    const media = await this._mediaService.saveFile(
      orgId,
      magnet.coverUrl.split('?')[0].split('/').pop()!,
      magnet.coverUrl
    );
    await this._repository.saveCoverMedia(id, media.id);
    return { id: media.id, path: magnet.coverUrl };
  }

  async updateMessage(orgId: string, id: string, body: LeadMessageDto) {
    const message = await this.messageOrFail(orgId, id);
    const original = message.original || body.original?.trim() || '';
    if (
      body.defaultVersion !== 'original' &&
      !body.versions.some((p) => p.id === body.defaultVersion)
    ) {
      throw new BadRequestException('The default version does not exist');
    }
    return this._repository.updateMessage(id, original, body);
  }

  private async styleGuide(orgId: string) {
    const voice = await this._xVoiceService.resolve(orgId, {});
    return voice?.styleGuide || undefined;
  }

  // writes the originals of the messages that have none
  async draftMagnet(orgId: string, id: string) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, drafted: 0, error: null };
    }

    const magnet = await this.magnetOrFail(orgId, id);
    const empty = magnet.messages.filter((p) => !p.original);
    if (!empty.length) {
      return { available: true, drafted: 0, error: null };
    }

    const result = await this._anthropicService.generateLeadMessages(
      magnet,
      empty,
      await this.styleGuide(orgId)
    );
    if (result.status !== 'ok') {
      return { available: true, drafted: 0, error: result.status };
    }

    const drafted = empty.flatMap((slot) => {
      const text = result.data.find((p) => p.position === slot.position)?.text;
      return text ? [{ id: slot.id, text }] : [];
    });
    await Promise.all(
      drafted.map((p) => this._repository.saveDraft(p.id, p.text))
    );
    return { available: true, drafted: drafted.length, error: null };
  }

  // a new draft never replaces anything: it is saved as another copy
  async redraftMessage(orgId: string, id: string) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, error: null };
    }

    const message = await this.messageOrFail(orgId, id);
    const fullError = () =>
      new BadRequestException(
        `A message can keep ${MAX_LEAD_VERSIONS} copies: delete one first`
      );
    if (
      message.original &&
      (message.versions as unknown[]).length >= MAX_LEAD_VERSIONS
    ) {
      throw fullError();
    }

    const result = await this._anthropicService.generateLeadMessages(
      message.magnet,
      [message],
      await this.styleGuide(orgId)
    );
    if (result.status !== 'ok') {
      return { available: true, error: result.status };
    }

    const text = result.data[0]?.text;
    if (!text) {
      return { available: true, error: 'error' };
    }

    // read again, the user can edit the message during the Claude call
    const current = await this.messageOrFail(orgId, id);
    if (!current.original) {
      await this._repository.saveDraft(id, text);
      return { available: true, error: null };
    }

    const versions = current.versions as Array<{ name: string }>;
    if (versions.length >= MAX_LEAD_VERSIONS) {
      throw fullError();
    }
    await this._repository.saveVersions(id, [
      ...versions,
      { id: makeId(10), name: `Redraft ${versions.length + 1}`, text },
    ]);
    return { available: true, error: null };
  }
}
