import {
  MediaBunnyVideoFrameSource,
  type DecodedVideoFrame,
} from './media/VideoFrameSource';
import {
  Input,
  ALL_FORMATS,
  BlobSource,
  AudioBufferSink,
} from 'mediabunny';
import { loadImage } from './media/MediaLoader';

export type ClipType = 'video' | 'image' | 'audio';

export interface CompositionOptions {
  /** Timeline length in seconds; <= 0 derives from clips and source media. */
  duration?: number;
  outputFilename?: string;
}

export abstract class Clip {
  abstract readonly type: ClipType;

  constructor(
    readonly url: string,
    readonly start: number,
    /** Seconds on the timeline; <= 0 lets media-backed clips use their full source. */
    public duration: number,
    /** Normalized top-left (0-1). */
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
  ) {}

  containsTime(time: number, duration = this.duration): boolean {
    if (duration <= 0) {
      return time >= this.start;
    }

    return time >= this.start && time < this.start + duration;
  }

  localTimeAt(time: number): number {
    return time - this.start; // relative to clip start
  }

  timelineEnd(duration = this.duration): number {
    return this.start + Math.max(0, duration);
  }
}

export class VideoClip extends Clip {
  readonly type = 'video';
  private source: MediaBunnyVideoFrameSource | null = null;
  private frameStream: AsyncGenerator<DecodedVideoFrame> | null = null;

  constructor(
    url: string,
    start: number,
    duration = 0,
    x = 0,
    y = 0,
    width = 1,
    height = 1,
  ) {
    super(url, start, duration, x, y, width, height);
  }

  async openVideoSource(): Promise<MediaBunnyVideoFrameSource> {
    if (!this.source) {
      this.source = await MediaBunnyVideoFrameSource.open(this.url);
      this.duration = this.resolveDurationFromSource();
    }

    return this.source;
  }

  get sourceDuration(): number {
    return this.source?.duration ?? 0;
  }

  effectiveDuration(): number {
    return this.resolveDurationFromSource();
  }

  async nextSourceFrame(sourceTime: number, frameIndex: number): Promise<DecodedVideoFrame> {
    if (this.frameStream) {
      const result = await this.frameStream.next();
      if (result.done) {
        throw new Error(`MediaBunny video stream ended before export frame ${frameIndex}`);
      }

      return result.value;
    }

    const source = await this.openVideoSource();
    return source.frameAtTime(sourceTime, frameIndex);
  }

  async framesAtTimestamps(timestamps: Iterable<number>): Promise<AsyncGenerator<DecodedVideoFrame>> {
    const source = await this.openVideoSource();
    return source.framesAtTimestamps(timestamps);
  }

  async bindFrameStream(videoFrames: Iterable<VideoFrameContext>): Promise<void> {
    const timestamps: number[] = [];
    for (const context of videoFrames) {
      for (const videoLayer of context.videos) {
        if (videoLayer.clip === this) {
          timestamps.push(videoLayer.sourceTime);
        }
      }
    }

    if (timestamps.length === 0) {
      this.frameStream = null;
      return;
    }

    this.frameStream = await this.framesAtTimestamps(timestamps);
  }

  disposeSource(): void {
    this.source?.dispose();
    this.source = null;
    this.frameStream = null;
  }

  private resolveDurationFromSource(): number {
    if (this.sourceDuration <= 0) {
      return Math.max(0, this.duration);
    }

    if (this.duration <= 0) {
      return this.sourceDuration;
    }

    return Math.min(this.duration, this.sourceDuration);
  }
}

export class ImageClip extends Clip {
  readonly type = 'image';
  private image: HTMLImageElement | null = null;

  constructor(
    url: string,
    start: number,
    duration = 0,
    x = 0,
    y = 0,
    width = 1,
    height = 1,
    readonly opacity = 1,
  ) {
    super(url, start, duration, x, y, width, height);
  }

  async loadImageElement(): Promise<HTMLImageElement> {
    if (!this.image) {
      this.image = await loadImage(this.url);
    }

    return this.image;
  }

  disposeImage(): void {
    this.image = null;
  }
}

export class AudioClip extends Clip {
  readonly type = 'audio';
  private input: Input | null = null;
  private sourceDuration = 0;

  constructor(
    url: string,
    start: number,
    duration = 0,
  ) {
    super(url, start, duration, 0, 0, 0, 0);
  }

  async openAudioSource(): Promise<void> {
    if (this.input) {
      return;
    }

    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio source: ${this.url} (${response.status})`);
    }

    const blob = await response.blob();
    this.input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });

    const audioTrack = await this.input.getPrimaryAudioTrack();
    if (!audioTrack) {
      this.sourceDuration = 0;
      return;
    }

    this.sourceDuration = await audioTrack.computeDuration();
    this.duration = this.resolveDurationFromSource();
  }

  async getAudioBuffer(): Promise<AudioBuffer | null> {
    await this.openAudioSource();

    const audioTrack = await this.input?.getPrimaryAudioTrack();
    if (!audioTrack || this.duration <= 0) {
      return null;
    }

    const sampleRate = audioTrack.sampleRate;
    const channels = Math.min(2, Math.max(1, audioTrack.numberOfChannels));
    const startTime = 0;
    const endTime = startTime + this.duration;
    const frameCount = Math.ceil(this.duration * sampleRate);

    const audioContext = new AudioContext({ sampleRate });
    const merged = audioContext.createBuffer(channels, frameCount, sampleRate);
    const sink = new AudioBufferSink(audioTrack);

    for await (const wrapped of sink.buffers(startTime, endTime)) {
      const offset = Math.round((wrapped.timestamp - startTime) * sampleRate);
      if (offset >= frameCount) {
        continue;
      }

      const source = wrapped.buffer;
      for (let channel = 0; channel < channels; channel++) {
        const srcChannel = source.getChannelData(
          Math.min(channel, source.numberOfChannels - 1),
        );
        const dstChannel = merged.getChannelData(channel);
        const copyLength = Math.min(srcChannel.length, frameCount - offset);
        for (let i = 0; i < copyLength; i++) {
          dstChannel[offset + i] = srcChannel[i];
        }
      }
    }

    return merged;
  }

  disposeSource(): void {
    this.input?.dispose();
    this.input = null;
    this.sourceDuration = 0;
  }

  private resolveDurationFromSource(): number {
    if (this.sourceDuration <= 0) {
      return Math.max(0, this.duration);
    }

    if (this.duration <= 0) {
      return this.sourceDuration;
    }

    return Math.min(this.duration, this.sourceDuration);
  }
}

export type LayerClipDefinition = VideoClip | ImageClip | AudioClip;

export type {Composition} from './composition';

export interface VideoLayerClip {
  type: 'video';
  clip: VideoClip;
  localTime: number;
  sourceTime: number;
  nextSourceFrame: () => Promise<DecodedVideoFrame>;
}

export interface ImageLayerClip {
  type: 'image';
  clip: ImageClip;
  localTime: number;
}

export type LayerClip = VideoLayerClip | ImageLayerClip;

export interface VideoFrameContext {
  frame: number;
  time: number;
  timestampUs: number;
  layers: LayerClip[];
  videos: VideoLayerClip[];
  images: ImageLayerClip[];
}

export interface ExportProgress {
  phase: 'audio' | 'video' | 'mux';
  frame: number;
  totalFrames: number;
  percent: number;
  message: string;
}
