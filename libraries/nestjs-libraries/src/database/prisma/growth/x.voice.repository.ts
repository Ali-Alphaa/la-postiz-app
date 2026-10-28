import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { XVoiceSample } from '@gitroom/helpers/utils/x.library';

const select = {
  id: true,
  handle: true,
  integrationId: true,
  samples: true,
  styleGuide: true,
  generatedAt: true,
  updatedAt: true,
};

@Injectable()
export class XVoiceRepository {
  constructor(
    private _xVoice: PrismaRepository<'xVoice'>,
    private _xVoiceProfile: PrismaRepository<'xVoiceProfile'>,
    private _integration: PrismaRepository<'integration'>
  ) {}

  list(orgId: string) {
    return this._xVoice.model.xVoice.findMany({
      where: { organizationId: orgId },
      select,
      orderBy: { updatedAt: 'desc' },
    });
  }

  count(orgId: string) {
    return this._xVoice.model.xVoice.count({
      where: { organizationId: orgId },
    });
  }

  get(orgId: string, handle: string) {
    return this._xVoice.model.xVoice.findUnique({
      where: { organizationId_handle: { organizationId: orgId, handle } },
      select,
    });
  }

  // the voice of one organization before voices were per account (read only)
  getLegacyProfile(orgId: string) {
    return this._xVoiceProfile.model.xVoiceProfile.findUnique({
      where: { organizationId: orgId },
      select: {
        handle: true,
        samples: true,
        styleGuide: true,
        generatedAt: true,
      },
    });
  }

  // creating twice at the same time is harmless
  createFromLegacy(
    orgId: string,
    handle: string,
    legacy: {
      samples: Prisma.JsonValue;
      styleGuide: string | null;
      generatedAt: Date | null;
    }
  ) {
    return this._xVoice.model.xVoice.upsert({
      where: { organizationId_handle: { organizationId: orgId, handle } },
      update: {},
      create: {
        organizationId: orgId,
        handle,
        samples: (legacy.samples ?? []) as Prisma.InputJsonValue,
        styleGuide: legacy.styleGuide,
        generatedAt: legacy.generatedAt,
      },
      select: { id: true },
    });
  }

  saveSamples(
    orgId: string,
    handle: string,
    samples: XVoiceSample[],
    integrationId: string | null
  ) {
    const values = {
      samples: samples as unknown as Prisma.InputJsonValue,
      ...(integrationId ? { integrationId } : {}),
    };
    return this._xVoice.model.xVoice.upsert({
      where: { organizationId_handle: { organizationId: orgId, handle } },
      update: values,
      create: { organizationId: orgId, handle, ...values },
      select: { id: true },
    });
  }

  saveStyleGuide(
    orgId: string,
    handle: string,
    styleGuide: string,
    generated: boolean,
    integrationId: string | null
  ) {
    const values = {
      styleGuide,
      ...(generated ? { generatedAt: new Date() } : {}),
      ...(integrationId ? { integrationId } : {}),
    };
    return this._xVoice.model.xVoice.upsert({
      where: { organizationId_handle: { organizationId: orgId, handle } },
      update: values,
      create: { organizationId: orgId, handle, ...values },
      select: { id: true },
    });
  }

  // the X channels of the organization; `profile` holds the X username
  xIntegrations(orgId: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: orgId,
        providerIdentifier: 'x',
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        picture: true,
        profile: true,
        disabled: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
