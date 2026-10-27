import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import { CompetitorsRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/competitors.repository';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { CompetitorDto } from '@gitroom/nestjs-libraries/dtos/growth/competitor.dto';

const MAX_COMPETITORS = 20;
const SYNC_EVERY_HOURS = 24;
const SYNC_BATCH = 50;
const POSTS_PER_SYNC = 40;

@Injectable()
export class CompetitorsService {
  constructor(
    private _competitorsRepository: CompetitorsRepository,
    private _integrationManager: IntegrationManager,
    private _openaiService: OpenaiService
  ) {}

  // the providers that can read any public account without authentication
  getProviders() {
    return socialIntegrationList
      .filter(
        (p) =>
          !!p.publicProfile &&
          !!p.publicPosts &&
          !this._integrationManager.isHiddenProvider(p.identifier)
      )
      .map((p) => ({ identifier: p.identifier, name: p.name }));
  }

  private getProvider(identifier: string) {
    const provider = this.getProviders().find(
      (p) => p.identifier === identifier
    )
      ? this._integrationManager.getSocialIntegration(identifier)
      : undefined;

    if (!provider?.publicProfile || !provider?.publicPosts) {
      throw new BadRequestException(
        'Competitor tracking is not available for this platform'
      );
    }

    return provider;
  }

  async getCompetitors(orgId: string) {
    const competitors = await this._competitorsRepository.getCompetitors(orgId);
    return competitors.map(({ snapshots, ...competitor }) => {
      const [latest] = snapshots;
      const delta = (days: number) => {
        const before = snapshots.find(
          (p) => dayjs().diff(p.createdAt, 'day', true) >= days - 0.5
        );
        return latest && before ? latest.followers - before.followers : null;
      };

      return {
        ...competitor,
        followers: latest?.followers ?? null,
        following: latest?.following ?? null,
        postsCount: latest?.postsCount ?? null,
        avgEngagement: latest?.avgEngagement ?? null,
        followersDelta7: delta(7),
        followersDelta30: delta(30),
        history: snapshots
          .map((p) => ({ date: p.createdAt, followers: p.followers }))
          .reverse(),
      };
    });
  }

  async addCompetitor(orgId: string, body: CompetitorDto) {
    const provider = this.getProvider(body.provider);

    if (
      (await this._competitorsRepository.countCompetitors(orgId)) >=
      MAX_COMPETITORS
    ) {
      throw new BadRequestException(
        `You can track up to ${MAX_COMPETITORS} competitors`
      );
    }

    let profile;
    try {
      profile = await provider.publicProfile!(body.handle);
    } catch (err) {
      console.log(err);
    }

    if (!profile) {
      throw new BadRequestException('Account not found');
    }

    const competitor = await this._competitorsRepository.upsertCompetitor(
      orgId,
      body.provider,
      profile
    );
    await this.syncCompetitor(competitor);
    return { id: competitor.id };
  }

  async deleteCompetitor(orgId: string, id: string) {
    await this._competitorsRepository.deleteCompetitor(orgId, id);
    return { id };
  }

  private async syncCompetitor(competitor: {
    id: string;
    provider: string;
    handle: string;
  }) {
    try {
      const provider = this.getProvider(competitor.provider);
      const profile = await provider.publicProfile!(competitor.handle);
      if (!profile) {
        await this._competitorsRepository.markSynced(competitor.id);
        return false;
      }

      const posts = await provider.publicPosts!(
        competitor.handle,
        POSTS_PER_SYNC
      );
      const avgEngagement = posts.length
        ? posts.reduce((all, p) => all + p.likes + p.reposts + p.replies, 0) /
          posts.length
        : 0;

      await this._competitorsRepository.saveSync(
        competitor.id,
        profile,
        posts,
        avgEngagement
      );
      return true;
    } catch (err) {
      console.log(err);
      await this._competitorsRepository.markSynced(competitor.id);
      return false;
    }
  }

  async syncCompetitors() {
    let synced = 0;
    for (const competitor of await this._competitorsRepository.getCompetitorsToSync(
      SYNC_EVERY_HOURS,
      SYNC_BATCH
    )) {
      if (await this.syncCompetitor(competitor)) {
        synced++;
      }
    }
    return synced;
  }

  async getInspiration(orgId: string, provider?: string) {
    return this._competitorsRepository.getInspiration(orgId, 30, provider);
  }

  async rewrite(orgId: string, id: string) {
    if (!this._openaiService.isAvailable()) {
      return { available: false, content: '' };
    }

    const post = await this._competitorsRepository.getCompetitorPost(orgId, id);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    try {
      return {
        available: true,
        content: await this._openaiService.rewritePost(post.content),
      };
    } catch (err) {
      console.log(err);
      return { available: true, content: '' };
    }
  }
}
