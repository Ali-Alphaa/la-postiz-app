import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { XNativeStatus } from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';

const QUEUE_SIZE = 50;

const select = {
  id: true,
  text: true,
  scheduledAt: true,
  status: true,
  syncedAt: true,
  claimedAt: true,
  error: true,
  sourceRepurposeId: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class XNativeRepository {
  constructor(private _xNativeSchedule: PrismaRepository<'xNativeSchedule'>) {}

  list(orgId: string, status?: XNativeStatus) {
    return this._xNativeSchedule.model.xNativeSchedule.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(status ? { status } : {}),
      },
      select,
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });
  }

  get(orgId: string, id: string) {
    return this._xNativeSchedule.model.xNativeSchedule.findFirst({
      where: { organizationId: orgId, id, deletedAt: null },
      select,
    });
  }

  create(
    orgId: string,
    data: { text: string; scheduledAt: Date; sourceRepurposeId?: string }
  ) {
    return this._xNativeSchedule.model.xNativeSchedule.create({
      data: { organizationId: orgId, ...data },
      select,
    });
  }

  // a changed post goes back to the queue
  update(
    orgId: string,
    id: string,
    data: { text?: string; scheduledAt?: Date }
  ) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: {
        organizationId: orgId,
        id,
        deletedAt: null,
        status: { in: ['pending', 'failed'] },
      },
      data: { ...data, status: 'pending', error: null },
    });
  }

  cancel(orgId: string, id: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: { organizationId: orgId, id, deletedAt: null },
      data: { status: 'cancelled' },
    });
  }

  // what the extension puts into X's scheduler next
  queue(orgId: string, from: Date, to: Date) {
    return this._xNativeSchedule.model.xNativeSchedule.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'pending',
        scheduledAt: { gt: from, lte: to },
      },
      select: { id: true, text: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
      take: QUEUE_SIZE,
    });
  }

  countPending(orgId: string, from: Date) {
    return this._xNativeSchedule.model.xNativeSchedule.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: 'pending',
        scheduledAt: { gt: from },
      },
    });
  }

  // the extension takes a post right before filling X's composer: a post
  // can only be claimed once, so it is never scheduled in X twice
  claim(orgId: string, id: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: {
        organizationId: orgId,
        id,
        deletedAt: null,
        status: { in: ['pending', 'failed'] },
      },
      data: { status: 'syncing', claimedAt: new Date(), error: null },
    });
  }

  // only a claimed post takes a result
  setResult(orgId: string, id: string, ok: boolean, error?: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: { organizationId: orgId, id, deletedAt: null, status: 'syncing' },
      data: ok
        ? { status: 'synced', syncedAt: new Date(), error: null }
        : { status: 'failed', error: error || 'Failed' },
    });
  }

  // the user checked X: the post is there
  confirm(orgId: string, id: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: { organizationId: orgId, id, deletedAt: null, status: 'syncing' },
      data: { status: 'synced', syncedAt: new Date(), error: null },
    });
  }

  // back to the queue
  retry(orgId: string, id: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: {
        organizationId: orgId,
        id,
        deletedAt: null,
        status: { in: ['syncing', 'failed'] },
      },
      data: { status: 'pending', claimedAt: null, error: null },
    });
  }
}
