import {
  BadRequestException,
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
import {
  oembedHtmlToTweet,
  parseTweetUrl,
} from '@gitroom/helpers/utils/x.library';

const OEMBED_TIMEOUT = 8000;
const MAX_SEARCHES = 8;

@Injectable()
export class SwipeService {
  constructor(
    private _swipeRepository: SwipeRepository,
    private _anthropicService: AnthropicService,
    private _xVoiceService: XVoiceService
  ) {}

  getTechniques() {
    return SWIPE_TECHNIQUES;
  }

  getEntries(orgId: string, query: SwipeQueryDto) {
    return this._swipeRepository.getEntries(orgId, query);
  }

  // saving the same post twice returns the row it already has
  async createEntry(orgId: string, entry: SwipeEntryDto) {
    const existing = entry.sourceUrl
      ? await this._swipeRepository.getBySourceUrl(orgId, entry.sourceUrl)
      : null;
    return (
      existing ||
      this._swipeRepository.createEntry(
        orgId,
        entry,
        SwipeStatus.LIBRARY,
        SwipeOrigin.MANUAL
      )
    );
  }

  updateEntry(orgId: string, id: string, entry: SwipeEntryDto) {
    return this._swipeRepository.updateEntry(orgId, id, entry);
  }

  setStatus(orgId: string, id: string, status: SwipeStatus) {
    return this._swipeRepository.setStatus(orgId, id, status);
  }

  setStarred(orgId: string, id: string, starred: boolean) {
    return this._swipeRepository.setStarred(orgId, id, starred);
  }

  deleteEntry(orgId: string, id: string) {
    return this._swipeRepository.deleteEntry(orgId, id);
  }

  importEntries(orgId: string, entries: SwipeEntryDto[]) {
    return this._swipeRepository.importEntries(orgId, entries);
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

    const entry = await this._swipeRepository.getEntry(orgId, id);
    if (!entry) {
      throw new NotFoundException('Swipe entry not found');
    }

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
      if (
        await this._swipeRepository.getBySourceUrl(orgId, example.sourceUrl)
      ) {
        continue;
      }
      await this._swipeRepository.createEntry(
        orgId,
        { ...example, topicTags: [body.topic.toLowerCase()] },
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

  // The free oEmbed endpoint of X reads tweets, nothing is scraped. Other
  // platforms have no free equivalent, so the user pastes the text.
  private async readTweet(parsed: { id: string; handle: string | null }) {
    try {
      const response = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(
          `https://twitter.com/${parsed.handle || 'i'}/status/${parsed.id}`
        )}&omit_script=true&dnt=true`,
        { signal: AbortSignal.timeout(OEMBED_TIMEOUT), redirect: 'error' }
      );
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return {
        author: data.author_name as string | undefined,
        text: oembedHtmlToTweet(String(data.html || '')).text,
      };
    } catch (err) {
      return null;
    }
  }

  async addLink(orgId: string, body: SwipeLinkDto) {
    const existing = await this._swipeRepository.getBySourceUrl(
      orgId,
      body.url
    );
    if (existing) {
      return existing;
    }

    const parsed = parseTweetUrl(body.url);
    const tweet = parsed ? await this.readTweet(parsed) : null;
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
        author: tweet?.author,
        sourceUrl: body.url,
        platform: parsed
          ? 'x'
          : new URL(body.url).hostname.replace(/^www\./, '').split('.')[0],
      },
      SwipeStatus.INBOX,
      SwipeOrigin.LINK
    );
  }
}
