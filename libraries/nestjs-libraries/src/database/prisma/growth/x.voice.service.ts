import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { XVoiceRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.repository';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import {
  bestVoiceSamples,
  mergeVoiceSamples,
  normalizeVoiceHandle,
  XVoiceSample,
} from '@gitroom/helpers/utils/x.library';

const MIN_VOICE_SAMPLES = 5;

type Voice = NonNullable<Awaited<ReturnType<XVoiceRepository['get']>>>;
type XChannel = Awaited<ReturnType<XVoiceRepository['xIntegrations']>>[number];

// One voice per X account of the organization: its own tweets and the style
// guide Claude writes from them
@Injectable()
export class XVoiceService {
  constructor(
    private _xVoiceRepository: XVoiceRepository,
    private _anthropicService: AnthropicService
  ) {}

  // The organization-wide voice of before is copied once, for its handle
  // (or the first X channel when it has none). The old row is kept.
  private async migrate(orgId: string, channels?: XChannel[]) {
    if (await this._xVoiceRepository.count(orgId)) {
      return;
    }
    const legacy = await this._xVoiceRepository.getLegacyProfile(orgId);
    if (!legacy) {
      return;
    }
    const handle =
      normalizeVoiceHandle(legacy.handle) ||
      normalizeVoiceHandle(
        (channels || (await this._xVoiceRepository.xIntegrations(orgId)))[0]
          ?.profile
      );
    if (handle) {
      await this._xVoiceRepository.createFromLegacy(orgId, handle, legacy);
    }
  }

  private channelOf(channels: XChannel[], handle: string) {
    return channels.find((p) => normalizeVoiceHandle(p.profile) === handle);
  }

  private summary(voice: Voice | null, handle: string, channel?: XChannel) {
    const samples = (voice?.samples || []) as unknown as XVoiceSample[];
    return {
      handle,
      hasVoice: !!voice,
      integrationId: channel?.id || voice?.integrationId || null,
      integration: channel
        ? { id: channel.id, name: channel.name, picture: channel.picture }
        : null,
      sampleCount: samples.length,
      hasGuide: !!voice?.styleGuide?.trim(),
      generatedAt: voice?.generatedAt || null,
      updatedAt: voice?.updatedAt || null,
    };
  }

  // the voices, then the X channels that have none yet
  async list(orgId: string) {
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    const voices = await this._xVoiceRepository.list(orgId);

    return [
      ...voices.map((voice) =>
        this.summary(
          voice,
          voice.handle,
          this.channelOf(channels, voice.handle)
        )
      ),
      ...channels
        .filter((channel) => {
          const handle = normalizeVoiceHandle(channel.profile);
          return handle && !voices.some((p) => p.handle === handle);
        })
        .map((channel) =>
          this.summary(null, normalizeVoiceHandle(channel.profile)!, channel)
        ),
    ];
  }

  private handleOrFail(value: string) {
    const handle = normalizeVoiceHandle(value);
    if (!handle) {
      throw new BadRequestException('This is not an X handle');
    }
    return handle;
  }

  async get(orgId: string, value: string) {
    const handle = this.handleOrFail(value);
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    const voice = await this._xVoiceRepository.get(orgId, handle);
    const samples = (voice?.samples || []) as unknown as XVoiceSample[];
    return {
      ...this.summary(voice, handle, this.channelOf(channels, handle)),
      aiAvailable: this._anthropicService.isAvailable(),
      styleGuide: voice?.styleGuide || '',
      best: bestVoiceSamples(samples, 5),
    };
  }

  async update(orgId: string, value: string, styleGuide: string) {
    const handle = this.handleOrFail(value);
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    await this._xVoiceRepository.saveStyleGuide(
      orgId,
      handle,
      styleGuide,
      false,
      this.channelOf(channels, handle)?.id || null
    );
    return { handle, styleGuide };
  }

  async generate(orgId: string, value: string) {
    const handle = this.handleOrFail(value);
    if (!this._anthropicService.isAvailable()) {
      return { available: false, handle, styleGuide: '', error: null };
    }

    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    const voice = await this._xVoiceRepository.get(orgId, handle);
    const samples = bestVoiceSamples(
      (voice?.samples || []) as unknown as XVoiceSample[]
    );
    if (samples.length < MIN_VOICE_SAMPLES) {
      throw new BadRequestException(
        `At least ${MIN_VOICE_SAMPLES} tweets of @${handle} are needed: open your x.com profile while logged in as @${handle} with the extension installed`
      );
    }

    const result = await this._anthropicService.generateVoiceGuide(samples);
    if (result.status !== 'ok') {
      return { available: true, handle, styleGuide: '', error: result.status };
    }

    await this._xVoiceRepository.saveStyleGuide(
      orgId,
      handle,
      result.data,
      true,
      this.channelOf(channels, handle)?.id || null
    );
    return { available: true, handle, styleGuide: result.data, error: null };
  }

  // own tweets captured by the extension: only the voice of their author
  async addOwnTweets(orgId: string, handle: string, tweets: XVoiceSample[]) {
    const normalized = normalizeVoiceHandle(handle);
    if (!normalized || !tweets.length) {
      return;
    }
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    const voice = await this._xVoiceRepository.get(orgId, normalized);
    await this._xVoiceRepository.saveSamples(
      orgId,
      normalized,
      mergeVoiceSamples(
        (voice?.samples || []) as unknown as XVoiceSample[],
        tweets
      ),
      this.channelOf(channels, normalized)?.id || null
    );
  }

  // The voice to write with: the one asked for, else the one of the X
  // channel the post goes to, else the most recently updated one; null when
  // the organization has no voice at all
  async resolve(
    orgId: string,
    options: { voiceHandle?: string; integrationId?: string }
  ) {
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);

    if (options.voiceHandle) {
      const handle = this.handleOrFail(options.voiceHandle);
      const voice = await this._xVoiceRepository.get(orgId, handle);
      if (!voice) {
        throw new NotFoundException(`@${handle} has no voice yet`);
      }
      return voice;
    }

    const channelHandle = normalizeVoiceHandle(
      channels.find((p) => p.id === options.integrationId)?.profile
    );
    if (channelHandle) {
      const voice = await this._xVoiceRepository.get(orgId, channelHandle);
      if (voice) {
        return voice;
      }
    }

    return (await this._xVoiceRepository.list(orgId))[0] || null;
  }

  // the style guide of a voice, or the friendly error naming the account
  styleGuideOrFail(voice: { handle: string; styleGuide: string | null }) {
    if (!voice.styleGuide?.trim()) {
      throw new BadRequestException(
        `Write or generate the voice of @${voice.handle} in "X: My voice" first`
      );
    }
    return voice.styleGuide;
  }

  // The routes of before voices were per account: the voice of the first X
  // channel, or the only (most recent) voice
  private async legacyHandle(orgId: string) {
    const channels = await this._xVoiceRepository.xIntegrations(orgId);
    await this.migrate(orgId, channels);
    const first = normalizeVoiceHandle(channels[0]?.profile);
    if (first) {
      return first;
    }
    return (await this._xVoiceRepository.list(orgId))[0]?.handle || null;
  }

  async getLegacy(orgId: string) {
    const handle = await this.legacyHandle(orgId);
    if (!handle) {
      return {
        aiAvailable: this._anthropicService.isAvailable(),
        handle: null,
        sampleCount: 0,
        styleGuide: '',
        generatedAt: null,
        best: [] as XVoiceSample[],
      };
    }
    return this.get(orgId, handle);
  }

  async updateLegacy(orgId: string, styleGuide: string) {
    const handle = await this.legacyHandle(orgId);
    if (!handle) {
      throw new BadRequestException(
        'Connect an X channel or open your x.com profile with the extension first'
      );
    }
    return this.update(orgId, handle, styleGuide);
  }

  async generateLegacy(orgId: string) {
    const handle = await this.legacyHandle(orgId);
    if (!handle) {
      throw new BadRequestException(
        'Connect an X channel or open your x.com profile with the extension first'
      );
    }
    return this.generate(orgId, handle);
  }
}
