import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { normalizeVariations } from '@gitroom/helpers/utils/x.library';
import {
  X_FORMATS,
  X_HOOK_TYPES,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';

// Claude (Anthropic) features of the growth pages. Every method degrades
// instead of throwing: the callers turn the status into a message.

const MAX_TOKENS = 16000;
// opt-in server-side retry on another model when the model declines
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const NICHE =
  'trading & markets (forex, stocks, crypto, options, trading psychology, risk management)';

const AnalysisPrompt = z.object({
  tweets: z.array(
    z.object({
      id: z.string(),
      topics: z
        .array(z.string())
        .describe('1 to 3 short lowercase topics, like "risk management"'),
      hookType: z.enum(X_HOOK_TYPES),
      format: z.enum(X_FORMATS),
      onNiche: z.boolean(),
    })
  ),
});

const RewritePrompt = z.object({
  drafts: z.array(
    z.object({
      posts: z
        .array(z.string())
        .describe('The posts of the draft, each one 280 characters or less'),
    })
  ),
});

const RepurposePrompt = z.object({
  variations: z
    .array(
      z.object({
        posts: z
          .array(z.string())
          .describe(
            'The posts of the variation, each one 280 characters or less'
          ),
      })
    )
    .describe('Exactly 5 variations'),
});

const SwipeRepurposePrompt = z.object({
  variants: z.array(
    z.object({
      technique: z.string().describe('The key of the technique used'),
      content: z.string(),
    })
  ),
});

const SwipeExamplesPrompt = z.object({
  examples: z.array(
    z.object({
      platform: z.enum(['x', 'instagram']),
      content: z.string().describe('The exact text of the post'),
      author: z.string(),
      sourceUrl: z.string(),
      formatTag: z.string().describe('Short name of the format of the post'),
      whyItWorks: z.string().describe('One sentence'),
    })
  ),
});

const CarouselSlide = z.object({
  title: z.string().describe('At most 8 words'),
  body: z.string().describe('At most 30 words, empty when the title is enough'),
});

const ContentPackPrompt = z.object({
  xThread: z
    .array(z.string())
    .describe('A thread of 3 to 7 posts, each 280 characters or less'),
  linkedinPost: z.string().describe('One LinkedIn post, under 1300 characters'),
  instagramCaption: z.string().describe('One Instagram caption'),
  carouselSlides: z
    .array(CarouselSlide)
    .describe('5 to 8 slides, the first is the hook, the last a call to action'),
  videoScript: z
    .string()
    .describe('A 30 to 45 second vertical video script with a hook, spoken lines and a call to action'),
});

const CarouselPrompt = z.object({
  caption: z.string().describe('The caption of the post'),
  slides: z.array(CarouselSlide),
});

// the public pages the swipe file search may read
const SWIPE_DOMAINS = {
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com'],
};
// a long search can pause, it is resumed at most this many times
const MAX_SEARCH_TURNS = 4;

export type AiStatus =
  | 'ok'
  | 'unavailable'
  | 'refusal'
  | 'rate_limited'
  | 'error';
export type AiResult<T> =
  | { status: 'ok'; data: T }
  | { status: Exclude<AiStatus, 'ok'> };

export interface TweetToAnalyze {
  id: string;
  text: string;
  mediaType: string;
}

export type TweetAnalysis = z.infer<typeof AnalysisPrompt>['tweets'][number];

@Injectable()
export class AnthropicService {
  private readonly _logger = new Logger(AnthropicService.name);
  private _client?: Anthropic;

  isAvailable() {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private get client() {
    if (!this._client) {
      this._client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this._client;
  }

  private get model() {
    return process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  }

  private failure(err: unknown): { status: 'rate_limited' | 'error' } {
    if (err instanceof Anthropic.RateLimitError) {
      this._logger.warn(`Anthropic rate limit: ${err.message}`);
      return { status: 'rate_limited' };
    }
    if (err instanceof Anthropic.APIError) {
      this._logger.error(
        `Anthropic API error ${err.status}: ${err.message} (${err.requestID})`
      );
      return { status: 'error' };
    }
    this._logger.error(`Anthropic call failed: ${(err as Error)?.message}`);
    return { status: 'error' };
  }

  private async parse<T extends z.ZodType>(
    schema: T,
    system: string,
    content: string,
    effort: 'low' | 'medium'
  ): Promise<AiResult<z.infer<T>>> {
    if (!this.isAvailable()) {
      return { status: 'unavailable' };
    }

    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
        output_config: { format: betaZodOutputFormat(schema), effort },
      });

      if (response.stop_reason === 'refusal') {
        this._logger.warn('Anthropic declined the request');
        return { status: 'refusal' };
      }

      if (!response.parsed_output) {
        this._logger.warn(
          `Anthropic returned no structured output (${response.stop_reason})`
        );
        return { status: 'error' };
      }

      return { status: 'ok', data: response.parsed_output as z.infer<T> };
    } catch (err) {
      return this.failure(err);
    }
  }

  private async text(
    system: string,
    content: string,
    effort: 'low' | 'medium'
  ): Promise<AiResult<string>> {
    if (!this.isAvailable()) {
      return { status: 'unavailable' };
    }

    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort },
      });

      if (response.stop_reason === 'refusal') {
        this._logger.warn('Anthropic declined the request');
        return { status: 'refusal' };
      }

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();

      return text ? { status: 'ok', data: text } : { status: 'error' };
    } catch (err) {
      return this.failure(err);
    }
  }

  // up to 20 tweets per call
  async analyzeViralTweets(
    tweets: TweetToAnalyze[]
  ): Promise<AiResult<TweetAnalysis[]>> {
    const result = await this.parse(
      AnalysisPrompt,
      `You tag viral posts from X (Twitter) for a creator whose niche is ${NICHE}.
For every post return:
- topics: 1 to 3 short lowercase topics
- hookType: how the first line grabs attention (question, contrarian, story, list, stat, how-to, announcement or other)
- format: one-liner, thread-starter (announces a thread or ends with a cue to read more), list, long-form or media-led (the text only makes sense with its photo or video)
- onNiche: true only when the post is about ${NICHE}
Return exactly one entry per post, with the id it was given.`,
      JSON.stringify(
        tweets.map((p) => ({ id: p.id, media: p.mediaType, text: p.text }))
      ),
      'low'
    );

    if (result.status !== 'ok') {
      return result;
    }

    return { status: 'ok', data: result.data.tweets };
  }

  async generateVoiceGuide(
    samples: Array<{ text: string; likes: number }>
  ): Promise<AiResult<string>> {
    return this.text(
      `You are a ghostwriter. Read the X (Twitter) posts of one creator, sorted from best to worst performing, and write a style guide another writer can follow to sound exactly like them.
Write it in markdown with these sections: Tone, Structure, Hooks, Vocabulary, Emoji and hashtags, Length, Do, Don't.
Base every point on what the posts really do (quote short patterns, not whole posts) and give more weight to the best performing ones. Answer with the style guide only.`,
      samples
        .map((p, index) => `#${index + 1} (${p.likes} likes)\n${p.text}`)
        .join('\n\n---\n\n'),
      'medium'
    );
  }

  // 3 alternative drafts, every draft is a list of posts (1 for a single post)
  async rewriteInVoice(
    tweet: string,
    styleGuide: string,
    options: { format: 'single' | 'thread' }
  ): Promise<AiResult<string[][]>> {
    const result = await this.parse(
      RewritePrompt,
      `You write X (Twitter) posts for a creator, in their voice, inspired by a post that went viral for someone else.
Follow the creator's style guide:
<style_guide>
${
  styleGuide.trim() ||
  'No style guide yet: write clear, direct and conversational posts.'
}
</style_guide>
Rules:
- Write 3 alternative drafts with different angles or hooks.
- ${
        options.format === 'thread'
          ? 'Every draft is a thread of 3 to 7 posts.'
          : 'Every draft is a single post.'
      }
- Every post is 280 characters or less.
- Keep the idea that made the original work, but never copy its phrases or sentences and never mention its author.
- Keep facts generic: no numbers, results, names or claims that are not in the original post or that you cannot be sure of.
- No hashtags, unless the style guide says the creator uses them.`,
      tweet,
      'medium'
    );

    if (result.status !== 'ok') {
      return result;
    }

    return {
      status: 'ok',
      data: result.data.drafts
        .map((draft) => draft.posts.map((p) => p.trim()).filter((p) => p))
        .filter((posts) => posts.length)
        .slice(0, 3),
    };
  }

  // exactly 5 variations with the tone and the message of the source tweets
  // (or the voice of the user), asked again once when the answer is short
  async repurposeTweets(
    tweets: Array<{ text: string }>,
    options: { format: 'single' | 'thread'; styleGuide?: string }
  ): Promise<AiResult<string[][]>> {
    const voice = options.styleGuide?.trim()
      ? `Write in the creator's voice, following their style guide:
<style_guide>
${options.styleGuide.trim()}
</style_guide>`
      : 'Keep the same tone, register and attitude as the source: someone who liked the source must recognize the same message and the same feeling.';

    const system = `You repurpose X (Twitter) posts. You get ${
      tweets.length > 1 ? 'several source posts' : 'a source post'
    } and write exactly 5 variations that keep the same core message.
${voice}
Rules:
- Exactly 5 variations, each with a different angle, hook or structure.
- ${
      options.format === 'thread'
        ? 'Every variation is a thread of 3 to 7 posts.'
        : 'Every variation is a single post.'
    }
- Every post is 280 characters or less.
- Never copy distinctive phrases or sentences of the source and never mention its author.
- No numbers, results, names or claims beyond what the source says.
- No hashtags, unless the source uses them.`;

    const content = tweets
      .map(
        (p, index) => `<source_${index + 1}>\n${p.text}\n</source_${index + 1}>`
      )
      .join('\n\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.parse(
        RepurposePrompt,
        system,
        content,
        'medium'
      );
      if (result.status !== 'ok') {
        return result;
      }

      const variations = normalizeVariations(
        result.data.variations.map((p) => p.posts)
      );
      if (variations) {
        return { status: 'ok', data: variations };
      }
      this._logger.warn(
        'Anthropic returned less than 5 variations, asking again'
      );
    }

    return { status: 'error' };
  }

  // one rewrite of a swipe file post per SCAMPER technique
  async repurposeSwipeEntry(
    entry: {
      content: string;
      platform: string;
      formatTag?: string | null;
      whyItWorks?: string | null;
    },
    techniques: ReadonlyArray<{ key: string; hint: string }>,
    options: { platform: string; styleGuide?: string; topic?: string }
  ): Promise<AiResult<Array<{ technique: string; content: string }>>> {
    const voice = options.styleGuide?.trim()
      ? `Write in the creator's voice, following their style guide:
<style_guide>
${options.styleGuide.trim()}
</style_guide>`
      : 'Keep the same tone and attitude as the source post.';

    const result = await this.parse(
      SwipeRepurposePrompt,
      `You turn a high-performing social media post into original posts for a creator whose niche is ${NICHE}.
Target platform: ${options.platform}. Respect its normal length and style.
${voice}
Rules:
- Write exactly one variant per technique, in the order they are given.
- Keep the structure that made the source work, but change the idea, the examples and the wording. Never copy its phrases and never mention its author.
- Write confidently and simply, with no hedging.
- No numbers, results, names or claims you cannot be sure of.
- No hashtags, unless the style guide says the creator uses them.`,
      `<source format="${entry.formatTag || 'unknown'}">
${entry.content}
</source>
${entry.whyItWorks ? `<why_it_works>${entry.whyItWorks}</why_it_works>\n` : ''}${
        options.topic ? `<topic>${options.topic}</topic>\n` : ''
      }<techniques>
${techniques.map((p) => `- ${p.key}: ${p.hint}`).join('\n')}
</techniques>`,
      'medium'
    );

    if (result.status !== 'ok') {
      return result;
    }

    return { status: 'ok', data: result.data.variants };
  }

  // Claude searches the public web, then its notes are turned into rows. A
  // post is only kept when its link really came back from the search.
  async findSwipeExamples(
    topic: string,
    platform: 'x' | 'instagram' | 'both',
    count: number,
    maxSearches: number
  ) {
    if (!this.isAvailable()) {
      return { status: 'unavailable' as const };
    }

    const domains =
      platform === 'both'
        ? [...SWIPE_DOMAINS.x, ...SWIPE_DOMAINS.instagram]
        : SWIPE_DOMAINS[platform];
    const urls = new Set<string>();
    let notes = '';
    let searches = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
        {
          role: 'user',
          content: `Find ${count} high-performing public posts about: ${topic}`,
        },
      ];

      for (let turn = 0; turn < MAX_SEARCH_TURNS; turn++) {
        const response = await this.client.beta.messages.create({
          model: this.model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: `You find real, publicly visible, high-performing social media posts for a creator's swipe file.
Use web search. List each post with its exact text, its author and its link.
Only list a post whose text you really read in a search result, and never invent, complete or paraphrase one. It is fine to list fewer posts, or none.`,
          messages,
          tools: [
            {
              type: 'web_search_20260209',
              name: 'web_search',
              max_uses: maxSearches,
              allowed_domains: domains,
            },
          ],
          output_config: { effort: 'medium' },
        });

        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        searches += response.usage.server_tool_use?.web_search_requests || 0;

        if (response.stop_reason === 'refusal') {
          this._logger.warn('Anthropic declined the request');
          return { status: 'refusal' as const };
        }

        for (const block of response.content) {
          if (block.type === 'text') {
            notes += block.text;
          }
          if (
            block.type === 'web_search_tool_result' &&
            Array.isArray(block.content)
          ) {
            block.content.forEach((p) => urls.add(p.url));
          }
        }

        // the tool stays the same between turns, so a search that pauses
        // after spending its budget is not resumed
        if (
          response.stop_reason !== 'pause_turn' ||
          searches >= maxSearches
        ) {
          break;
        }
        messages.push({ role: 'assistant', content: response.content });
      }
    } catch (err) {
      return this.failure(err);
    }

    if (!urls.size || !notes.trim()) {
      return {
        status: 'ok' as const,
        data: { examples: [], searches, inputTokens, outputTokens },
      };
    }

    const parsed = await this.parse(
      SwipeExamplesPrompt,
      `Extract the social media posts listed in these research notes, at most ${count}. Copy their text exactly. Leave out anything that is not a specific post with a link.`,
      notes,
      'low'
    );
    if (parsed.status !== 'ok') {
      return parsed;
    }

    return {
      status: 'ok' as const,
      data: {
        examples: parsed.data.examples
          .filter((p) => p.content.trim() && urls.has(p.sourceUrl))
          .slice(0, count),
        searches,
        inputTokens,
        outputTokens,
      },
    };
  }

  private packVoice(styleGuide?: string) {
    return styleGuide?.trim()
      ? `Write in the creator's voice, following their style guide:
<style_guide>
${styleGuide.trim()}
</style_guide>`
      : 'Keep the same tone and attitude as the source.';
  }

  // one source becomes native content for every platform
  async contentPack(source: string, options: { styleGuide?: string }) {
    return this.parse(
      ContentPackPrompt,
      `You turn one piece of content into native posts for several platforms, for a creator whose niche is ${NICHE}.
${this.packVoice(options.styleGuide)}
Rules:
- Each format must feel native to its platform, not a copy of the others.
- If the source is someone else's post, keep the structure that made it work but change the idea, examples and wording, and never mention its author.
- No numbers, results, names or claims beyond what the source says. Never promise profits.
- No hashtags, unless the style guide says the creator uses them.`,
      `<source>\n${source}\n</source>`,
      'medium'
    );
  }

  async carouselFromText(
    source: string,
    options: { slides: number; styleGuide?: string }
  ) {
    return this.parse(
      CarouselPrompt,
      `You turn content into an Instagram or LinkedIn carousel for a creator whose niche is ${NICHE}.
${this.packVoice(options.styleGuide)}
Rules:
- Exactly ${options.slides} slides. The first is a hook, the last a call to action, each one makes a single point.
- Plain text only, no markdown or emoji.
- No numbers, results, names or claims beyond what the source says. Never promise profits.`,
      `<source>\n${source}\n</source>`,
      'medium'
    );
  }

  async writeWeeklyReview(data: unknown) {
    return this.text(
      `You review a creator's last week on social media. Their niche is ${NICHE}.
Write a short review in markdown with these sections: What worked, What didn't, Do this week (3 specific actions), Repost or rework (1 or 2 posts from the data).
Use only the numbers in the data, never invent any, and say plainly when there is too little data to conclude something. Do not open with praise.`,
      JSON.stringify(data),
      'medium'
    );
  }
}
