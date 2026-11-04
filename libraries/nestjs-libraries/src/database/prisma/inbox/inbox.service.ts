import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { InboxRepository } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import {
  Disconnect,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { InboxRemoteItem } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { XVoiceService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.service';
import {
  DmAutomationDto,
  INBOX_STATUSES,
  InboxQueryDto,
} from '@gitroom/nestjs-libraries/dtos/inbox/inbox.dto';
import { addUtmToContent } from '@gitroom/helpers/utils/utm.links';
import { stripPostHtml } from '@gitroom/helpers/utils/trading.compliance';

// Meta only allows a private reply within 7 days of the comment
const PRIVATE_REPLY_DAYS = 7;

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesKeyword = (text: string, keyword: string) =>
  new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegex(keyword)}($|[^\\p{L}\\p{N}])`,
    'iu'
  ).test(text);

@Injectable()
export class InboxService {
  private readonly _logger = new Logger(InboxService.name);

  constructor(
    private _inboxRepository: InboxRepository,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _anthropicService: AnthropicService,
    private _xVoiceService: XVoiceService,
    private _integrationService: IntegrationService
  ) {}

  async getChannels(orgId: string) {
    const channels = await this._inboxRepository.getChannels(orgId);
    return channels.map((p) => {
      const provider = this._integrationManager.getSocialIntegration(
        p.providerIdentifier
      );
      return {
        ...p,
        canSync: !!provider?.inboxItems,
        canPrivateReply: !!provider?.inboxPrivateReply,
        manualSyncOnly: !!provider?.inboxManualSyncOnly,
      };
    });
  }

  async getItems(orgId: string, query: InboxQueryDto) {
    return {
      items: await this._inboxRepository.getItems(orgId, query),
      open: await this._inboxRepository.countOpen(orgId),
    };
  }

  // a token that is out of date is renewed and the call tried once more
  private async withToken<T>(
    integration: Integration,
    call: (token: string) => Promise<T>,
    // a read of a post that is gone looks like a bad token, so reads don't refresh
    refreshOnError = true
  ): Promise<T> {
    const refresh = async () => {
      const data = await this._refreshIntegrationService.refresh(integration);
      if (!data || !data.accessToken) {
        throw new BadRequestException('Reconnect this channel');
      }
      integration.token = data.accessToken;
      integration.refreshToken = data.refreshToken;
      integration.tokenExpiration = dayjs()
        .add(data.expiresIn, 'seconds')
        .toDate();
    };

    if (dayjs(integration.tokenExpiration).isBefore(dayjs())) {
      await refresh();
    }
    try {
      return await call(integration.token);
    } catch (err) {
      if (err instanceof RefreshToken && refreshOnError) {
        await refresh();
        return call(integration.token);
      }
      throw err;
    }
  }

  private async syncIntegration(integration: Integration) {
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.inboxItems) {
      return 0;
    }

    const posts = (
      await this._inboxRepository.getRecentPosts(integration.id)
    ).map((p) => ({ postId: p.id, releaseId: p.releaseId! }));
    const remote = await this.withToken(
      integration,
      (token) =>
        provider.inboxItems!(integration.internalId, token, integration, posts),
      false
    );

    // the channel's own comments and messages are not inbox items
    const fresh = await this._inboxRepository.keepNew(
      integration.id,
      remote.filter(
        (p) =>
          p.externalId &&
          p.text &&
          !isNaN(new Date(p.receivedAt).getTime()) &&
          p.authorId !== integration.internalId
      )
    );

    let created = 0;
    for (const item of fresh) {
      const row = await this._inboxRepository.createItem(
        integration.organizationId,
        integration.id,
        item
      );
      if (row) {
        created++;
        if (item.kind === 'comment') {
          await this.runAutomations(integration, row.id, item);
        }
      }
    }
    return created;
  }

  // Never throws: a failed DM stays visible on the item for the user
  private async runAutomations(
    integration: Integration,
    itemId: string,
    item: InboxRemoteItem
  ) {
    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (
      !provider?.inboxPrivateReply ||
      !item.authorId ||
      dayjs().diff(item.receivedAt, 'day') >= PRIVATE_REPLY_DAYS
    ) {
      return;
    }

    const automations = await this._inboxRepository.getEnabledAutomations(
      integration.id
    );
    const automation = automations.find(
      (p) =>
        (!p.postId || p.postId === item.postId) &&
        // comments from before the automation was turned on never trigger it
        dayjs(item.receivedAt).isAfter(p.activatedAt) &&
        matchesKeyword(item.text, p.keyword)
    );
    if (
      !automation ||
      !(await this._inboxRepository.claimDm(
        itemId,
        automation.id,
        item.authorId
      ))
    ) {
      return;
    }

    const message = addUtmToContent(automation.dmText, {
      utm_source: integration.providerIdentifier,
      utm_medium: 'dm',
      ...(item.postId ? { utm_content: item.postId } : {}),
    });

    try {
      await this.withToken(integration, (token) =>
        provider.inboxPrivateReply!(
          integration.internalId,
          token,
          item.externalId,
          message,
          integration
        )
      );
    } catch (err) {
      this._logger.warn(`Comment DM failed: ${(err as Error).message}`);
      await this._inboxRepository.failDm(
        itemId,
        automation.id,
        item.authorId,
        (err as Error).message || ''
      );
      return;
    }

    if (automation.publicReply && provider.inboxReply) {
      try {
        await this.withToken(integration, (token) =>
          provider.inboxReply!(
            integration.internalId,
            token,
            { kind: 'comment', externalId: item.externalId },
            automation.publicReply!,
            integration
          )
        );
      } catch (err) {
        this._logger.warn(`Public reply failed: ${(err as Error).message}`);
      }
    }
  }

  // the recurring job: channels whose reads cost money are left to the button
  async syncAll() {
    const integrations = await this._inboxRepository.getSyncIntegrations();
    for (const integration of integrations) {
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
      if (!provider?.inboxItems || provider.inboxManualSyncOnly) {
        continue;
      }
      try {
        await this.syncIntegration(integration);
      } catch (err) {
        this._logger.warn(
          `Inbox sync failed for ${integration.id}: ${(err as Error).message}`
        );
        if (err instanceof Disconnect) {
          await this._integrationService
            .disconnectChannel(
              integration.organizationId,
              integration,
              err.message
            )
            .catch(() => undefined);
        }
      }
    }
  }

  async syncNow(orgId: string) {
    const integrations = await this._inboxRepository.getSyncIntegrations(orgId);
    const errors: Array<{ channel: string; error: string }> = [];
    let created = 0;
    for (const integration of integrations) {
      try {
        created += await this.syncIntegration(integration);
      } catch (err) {
        errors.push({
          channel: integration.name,
          error: (err as Error).message || 'Could not read this channel',
        });
      }
    }
    return { created, errors };
  }

  async draftReply(orgId: string, id: string) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, draft: null, error: null as string | null };
    }
    const item = await this._inboxRepository.getItem(orgId, id);
    if (!item) {
      throw new NotFoundException('Message not found');
    }

    const voice = await this._xVoiceService.resolve(orgId, {
      integrationId: item.integrationId,
    });
    const post = item.postId
      ? await this._inboxRepository.getPostText(orgId, item.postId)
      : null;
    const result = await this._anthropicService.draftInboxReply(
      item.text,
      item.kind,
      {
        styleGuide: voice?.styleGuide || undefined,
        post: post ? stripPostHtml(post.content) : undefined,
      }
    );
    return result.status === 'ok'
      ? { available: true, draft: result.data, error: null }
      : { available: true, draft: null, error: result.status };
  }

  async reply(orgId: string, id: string, text: string) {
    const item = await this._inboxRepository.getItem(orgId, id);
    if (!item) {
      throw new NotFoundException('Message not found');
    }
    const integration = await this._inboxRepository.getIntegration(
      orgId,
      item.integrationId
    );
    const provider =
      integration &&
      this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
    if (!integration || !provider?.inboxReply) {
      throw new BadRequestException('This channel cannot send replies');
    }

    try {
      await this.withToken(integration, (token) =>
        provider.inboxReply!(
          integration.internalId,
          token,
          {
            kind: item.kind as InboxRemoteItem['kind'],
            externalId: item.externalId,
            threadId: item.threadId || undefined,
            authorId: item.authorId || undefined,
          },
          text,
          integration
        )
      );
    } catch (err) {
      throw new BadRequestException(
        (err as Error).message || 'The reply could not be sent'
      );
    }

    await this._inboxRepository.markReplied(orgId, id, text);
    return { sent: true };
  }

  setStatus(
    orgId: string,
    id: string,
    status: (typeof INBOX_STATUSES)[number]
  ) {
    return this._inboxRepository.setStatus(orgId, id, status);
  }

  getAutomations(orgId: string) {
    return this._inboxRepository.getAutomations(orgId);
  }

  async saveAutomation(orgId: string, body: DmAutomationDto, id?: string) {
    if (body.keyword.trim().length < 2) {
      throw new BadRequestException('The keyword is too short');
    }
    const integration = await this._inboxRepository.getIntegration(
      orgId,
      body.integrationId
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }
    if (
      !this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      )?.inboxPrivateReply
    ) {
      throw new BadRequestException('This channel cannot send comment DMs');
    }
    return this._inboxRepository.saveAutomation(orgId, body, id);
  }

  deleteAutomation(orgId: string, id: string) {
    return this._inboxRepository.deleteAutomation(orgId, id);
  }
}
