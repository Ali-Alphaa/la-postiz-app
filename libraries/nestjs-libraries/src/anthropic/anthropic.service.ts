import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
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

export type AiStatus = 'ok' | 'unavailable' | 'refusal' | 'rate_limited' | 'error';
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
${styleGuide.trim() || 'No style guide yet: write clear, direct and conversational posts.'}
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
}
