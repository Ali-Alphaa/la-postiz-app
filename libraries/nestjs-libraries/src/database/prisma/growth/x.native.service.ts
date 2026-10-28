import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { XNativeRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.native.repository';
import { XInspirationRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.repository';
import {
  XNativeDto,
  XNativeResultDto,
  XNativeStatus,
  XNativeUpdateDto,
  XRepurposeNativeDto,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';
import { nativeScheduleError } from '@gitroom/helpers/utils/x.library';
import { weightedLength } from '@gitroom/helpers/utils/count.length';

// The queue of posts the browser extension puts into X's own scheduler
// (X Premium web composer), when the user clicks "Sync" in the extension.
// X publishes them; Postiz never posts these.
const STALE_CLAIM_MS = 15 * 60 * 1000;

@Injectable()
export class XNativeService {
  constructor(
    private _xNativeRepository: XNativeRepository,
    private _xInspirationRepository: XInspirationRepository
  ) {}

  private check(text: string, scheduledAt: Date) {
    const error = nativeScheduleError(text, scheduledAt, weightedLength);
    if (error) {
      throw new BadRequestException(error);
    }
  }

  // a claim with no result for 15 minutes: the post may or may not be in
  // X's scheduler, the user checks
  async list(orgId: string, status?: XNativeStatus) {
    const stale = Date.now() - STALE_CLAIM_MS;
    return (await this._xNativeRepository.list(orgId, status)).map((p) => ({
      ...p,
      needsCheck:
        p.status === 'syncing' &&
        !!p.claimedAt &&
        p.claimedAt.getTime() < stale,
    }));
  }

  async create(orgId: string, body: XNativeDto, sourceRepurposeId?: string) {
    const text = body.text.trim();
    const scheduledAt = new Date(body.scheduledAt);
    this.check(text, scheduledAt);
    return this._xNativeRepository.create(orgId, {
      text,
      scheduledAt,
      sourceRepurposeId,
    });
  }

  async update(orgId: string, id: string, body: XNativeUpdateDto) {
    const item = await this._xNativeRepository.get(orgId, id);
    if (!item) {
      throw new NotFoundException('Scheduled post not found');
    }
    if (item.status !== 'pending' && item.status !== 'failed') {
      throw new BadRequestException(
        item.status === 'synced'
          ? 'This post is already in X: change it in the scheduled posts of X'
          : item.status === 'syncing'
          ? 'This post is being synced to X right now'
          : 'This post was cancelled'
      );
    }

    const text = body.text !== undefined ? body.text.trim() : item.text;
    const scheduledAt =
      body.scheduledAt !== undefined
        ? new Date(body.scheduledAt)
        : item.scheduledAt;
    this.check(text, scheduledAt);

    await this._xNativeRepository.update(orgId, id, { text, scheduledAt });
    return this._xNativeRepository.get(orgId, id);
  }

  async cancel(orgId: string, id: string) {
    const { count } = await this._xNativeRepository.cancel(orgId, id);
    if (!count) {
      throw new NotFoundException('Scheduled post not found');
    }
    return { id };
  }

  // a repurposed variation goes to X's scheduler instead of a Postiz post
  async fromRepurpose(orgId: string, id: string, body: XRepurposeNativeDto) {
    const repurpose = await this._xInspirationRepository.getRepurpose(
      orgId,
      id
    );
    if (!repurpose) {
      throw new NotFoundException('Variations not found');
    }
    const variations = repurpose.variations as unknown as string[][];
    if (body.index >= variations.length) {
      throw new BadRequestException('Variation not found');
    }

    const item = await this.create(orgId, body, repurpose.id);
    await this._xInspirationRepository.setRepurposeChoice(
      orgId,
      id,
      body.index,
      variations.map((p, index) => (index === body.index ? [item.text] : p))
    );
    return item;
  }

  // for the extension: the pending posts of the next days, oldest first
  async queue(orgId: string, days: number) {
    const now = new Date();
    const items = await this._xNativeRepository.queue(
      orgId,
      now,
      new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    );
    return {
      items,
      pending: await this._xNativeRepository.countPending(orgId, now),
    };
  }

  async result(orgId: string, id: string, body: XNativeResultDto) {
    const { count } = await this._xNativeRepository.setResult(
      orgId,
      id,
      body.ok,
      body.error?.slice(0, 500)
    );
    if (!count) {
      throw new NotFoundException('Scheduled post not found');
    }
    return { id, status: body.ok ? 'synced' : 'failed' };
  }

  async claim(orgId: string, id: string) {
    const { count } = await this._xNativeRepository.claim(orgId, id);
    if (!count) {
      throw new BadRequestException(
        'This post is not waiting for the X scheduler anymore'
      );
    }
    return { id, status: 'syncing' };
  }

  async confirm(orgId: string, id: string) {
    const { count } = await this._xNativeRepository.confirm(orgId, id);
    if (!count) {
      throw new NotFoundException('Scheduled post not found');
    }
    return { id, status: 'synced' };
  }

  async retry(orgId: string, id: string) {
    const { count } = await this._xNativeRepository.retry(orgId, id);
    if (!count) {
      throw new NotFoundException('Scheduled post not found');
    }
    return { id, status: 'pending' };
  }
}
