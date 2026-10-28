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

  // only a post still waiting for the extension takes a result
  setResult(orgId: string, id: string, ok: boolean, error?: string) {
    return this._xNativeSchedule.model.xNativeSchedule.updateMany({
      where: {
        organizationId: orgId,
        id,
        deletedAt: null,
        status: { in: ['pending', 'failed'] },
      },
      data: ok
        ? { status: 'synced', syncedAt: new Date(), error: null }
        : { status: 'failed', error: error || 'Failed' },
    });
  }
}
