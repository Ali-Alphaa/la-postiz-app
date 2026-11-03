import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SwipeOrigin, SwipeStatus } from '@prisma/client';
import { SwipeRepository } from '@gitroom/nestjs-libraries/database/prisma/swipe/swipe.repository';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { XVoiceService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.service';
import {
  SWIPE_TECHNIQUES,
  SwipeEntryDto,
  SwipeFindDto,
  SwipeLinkDto,
  SwipeQueryDto,
  SwipeRepurposeDto,
} from '@gitroom/nestjs-libraries/dtos/swipe/swipe.dto';
import { XInspirationService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.service';
import { parseTweetUrl } from '@gitroom/helpers/utils/x.library';

const MAX_SEARCHES = 8;

const PLATFORM_HOSTS: Record<string, string> = {
  'instagram.com': 'instagram',
  'threads.net': 'threads',
  'threads.com': 'threads',
  'linkedin.com': 'linkedin',
  'tiktok.com': 'tiktok',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'facebook.com': 'facebook',
  'reddit.com': 'reddit',
};

// every link of a tweet is stored the same way, so the same post is found again
const canonicalUrl = (url: string) => parseTweetUrl(url)?.url || url;

const platformOfUrl = (url: string) => {
  const host = new URL(url).hostname.toLowerCase();
  const known = Object.keys(PLATFORM_HOSTS).find(
    (p) => host === p || host.endsWith(`.${p}`)
  );
  return known ? PLATFORM_HOSTS[known] : 'other';
};

@Injectable()
export class SwipeService {
  constructor(
    private _swipeRepository: SwipeRepository,
    private _anthropicService: AnthropicService,
    private _xVoiceService: XVoiceService,
    private _xInspirationService: XInspirationService
  ) {}

  private async entryOrFail(orgId: string, id: string) {
    const entry = await this._swipeRepository.getEntry(orgId, id);
    if (!entry) {
      throw new NotFoundException('Swipe entry not found');
    }
    return entry;
  }

  private withCanonicalUrl(entry: SwipeEntryDto): SwipeEntryDto {
    return entry.sourceUrl
      ? { ...entry, sourceUrl: canonicalUrl(entry.sourceUrl) }
      : entry;
  }

  getTechniques() {
    return SWIPE_TECHNIQUES;
  }

  getEntries(orgId: string, query: SwipeQueryDto) {
    return this._swipeRepository.getEntries(orgId, query);
  }

  // a post is kept once: the message tells the frontend it is already saved
  async createEntry(orgId: string, body: SwipeEntryDto) {
    const entry = this.withCanonicalUrl(body);
    if (
      entry.sourceUrl &&
      (await this._swipeRepository.getBySourceUrl(orgId, entry.sourceUrl))
    ) {
      throw new ConflictException('duplicate');
    }
    return this._swipeRepository.createEntry(
      orgId,
      entry,
      SwipeStatus.LIBRARY,
      SwipeOrigin.MANUAL
    );
  }

  async updateEntry(orgId: string, id: string, entry: SwipeEntryDto) {
    await this.entryOrFail(orgId, id);
    return this._swipeRepository.updateEntry(
      orgId,
      id,
      this.withCanonicalUrl(entry)
    );
  }

  async setStatus(orgId: string, id: string, status: SwipeStatus) {
    await this.entryOrFail(orgId, id);
    return this._swipeRepository.setStatus(orgId, id, status);
  }

  async setStarred(orgId: string, id: string, starred: boolean) {
    await this.entryOrFail(orgId, id);
    return this._swipeRepository.setStarred(orgId, id, starred);
  }

  async deleteEntry(orgId: string, id: string) {
    await this.entryOrFail(orgId, id);
    return this._swipeRepository.deleteEntry(orgId, id);
  }

  importEntries(orgId: string, entries: SwipeEntryDto[]) {
    return this._swipeRepository.importEntries(
      orgId,
      entries.map((p) => this.withCanonicalUrl(p))
    );
  }

  getRuns(orgId: string) {
    return this._swipeRepository.getRuns(orgId);
  }

  async repurpose(orgId: string, id: string, body: SwipeRepurposeDto) {
    if (!this._anthropicService.isAvailable()) {
      return {
        available: false,
        variants: [] as Array<{ technique: string; content: string }>,
        error: null as string | null,
      };
    }

    const entry = await this.entryOrFail(orgId, id);

    let styleGuide: string | undefined;
    if (body.voiceHandle) {
      const voice = await this._xVoiceService.resolve(orgId, {
        voiceHandle: body.voiceHandle,
      });
      styleGuide = voice
        ? this._xVoiceService.styleGuideOrFail(voice)
        : undefined;
    }

    const result = await this._anthropicService.repurposeSwipeEntry(
      entry,
      SWIPE_TECHNIQUES.filter((p) => body.techniques.includes(p.key)),
      {
        platform: body.platform || entry.platform,
        styleGuide,
        topic: body.topic,
      }
    );
    if (result.status !== 'ok') {
      return { available: true, variants: [], error: result.status };
    }

    await this._swipeRepository.markRepurposed(orgId, id);
    return { available: true, variants: result.data, error: null };
  }

  // Everything Claude finds goes to the inbox, the user approves it
  async findExamples(orgId: string, body: SwipeFindDto) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, found: 0, searches: 0, error: null };
    }

    const result = await this._anthropicService.findSwipeExamples(
      body.topic,
      body.platform || 'x',
      body.count,
      MAX_SEARCHES
    );
    if (result.status !== 'ok') {
      return { available: true, found: 0, searches: 0, error: result.status };
    }

    let found = 0;
    for (const example of result.data.examples) {
      const sourceUrl = canonicalUrl(example.sourceUrl);
      if (await this._swipeRepository.getBySourceUrl(orgId, sourceUrl, true)) {
        continue;
      }
      await this._swipeRepository.createEntry(
        orgId,
        { ...example, sourceUrl, topicTags: [body.topic.toLowerCase()] },
        SwipeStatus.INBOX,
        SwipeOrigin.AI
      );
      found++;
    }

    await this._swipeRepository.createRun(orgId, {
      topic: body.topic,
      searches: result.data.searches,
      found,
      inputTokens: result.data.inputTokens,
      outputTokens: result.data.outputTokens,
    });

    return {
      available: true,
      found,
      searches: result.data.searches,
      error: null,
    };
  }

  // X links are read through its free oEmbed endpoint, nothing is scraped.
  // Other platforms have no free equivalent, so the user pastes the text.
  async addLink(orgId: string, body: SwipeLinkDto) {
    const parsed = parseTweetUrl(body.url);
    const sourceUrl = parsed?.url || body.url;
    const existing = await this._swipeRepository.getBySourceUrl(
      orgId,
      sourceUrl
    );
    if (existing) {
      return existing;
    }

    const tweet = parsed
      ? await this._xInspirationService.readTweet(parsed)
      : null;
    const content = body.content?.trim() || tweet?.text;
    if (!content) {
      throw new BadRequestException(
        parsed
          ? 'Could not read this post, paste its text too'
          : 'Only X links can be read automatically, paste the text of the post too'
      );
    }

    return this._swipeRepository.createEntry(
      orgId,
      {
        content,
        author: tweet?.authorName || tweet?.authorHandle,
        sourceUrl,
        platform: parsed ? 'x' : platformOfUrl(body.url),
      },
      SwipeStatus.INBOX,
      SwipeOrigin.LINK
    );
  }
}
