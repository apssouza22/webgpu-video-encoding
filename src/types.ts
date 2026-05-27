import {
  MediaBunnyVideoFrameSource,
  type DecodedVideoFrame,
} from './media/VideoFrameSource';

export type ClipType = 'video' | 'image';

export type ClipDurationOverrides = ReadonlyMap<Clip, number>;

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
    readonly duration: number,
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
    return time - this.start;
  }

  timelineEnd(duration = this.duration): number {
    return this.start + Math.max(0, duration);
  }
}

export class VideoClip extends Clip {
  readonly type = 'video';
  private source: MediaBunnyVideoFrameSource | null = null;

  constructor(
    url: string,
    start: number,
    duration: number,
    x = 0,
    y = 0,
    width = 1,
    height = 1,
  ) {
    super(url, start, duration, x, y, width, height);
  }

  async openSource(): Promise<MediaBunnyVideoFrameSource> {
    if (!this.source) {
      this.source = await MediaBunnyVideoFrameSource.open(this.url);
    }

    return this.source;
  }

  get sourceDuration(): number {
    return this.source?.duration ?? 0;
  }

  effectiveDuration(): number {
    if (this.duration > 0) {
      return this.duration;
    }

    return this.sourceDuration;
  }

  async nextSourceFrame(sourceTime: number, frameIndex: number): Promise<DecodedVideoFrame> {
    const source = await this.openSource();
    return source.frameAtTime(sourceTime, frameIndex);
  }

  async framesAtTimestamps(timestamps: Iterable<number>): Promise<AsyncGenerator<DecodedVideoFrame>> {
    const source = await this.openSource();
    return source.framesAtTimestamps(timestamps);
  }

  disposeSource(): void {
    this.source?.dispose();
    this.source = null;
  }
}

export class ImageClip extends Clip {
  readonly type = 'image';

  constructor(
    url: string,
    start: number,
    duration: number,
    x: number,
    y: number,
    width: number,
    height: number,
    readonly opacity = 1,
  ) {
    super(url, start, duration, x, y, width, height);
  }
}

export type LayerClipDefinition = VideoClip | ImageClip;

export class Composition {
  private readonly layerList: LayerClipDefinition[] = [];

  readonly duration: number;
  readonly outputFilename: string;

  constructor(
    readonly fps: number,
    readonly width: number,
    readonly height: number,
    options: CompositionOptions = {},
  ) {
    this.duration = options.duration ?? 0;
    this.outputFilename = options.outputFilename ?? 'composition-export.mp4';
  }

  addLayer<T extends LayerClipDefinition>(clip: T): this {
    this.layerList.push(clip);
    return this;
  }

  get layers(): readonly LayerClipDefinition[] {
    return this.layerList;
  }

  get videoLayers(): VideoClip[] {
    return this.layerList.filter((clip): clip is VideoClip => clip.type === 'video');
  }

  get imageLayers(): ImageClip[] {
    return this.layerList.filter((clip): clip is ImageClip => clip.type === 'image');
  }

  get video(): VideoClip | null {
    return this.videoLayers[0] ?? null;
  }

  get image(): ImageClip | null {
    return this.imageLayers[0] ?? null;
  }

  async openLayerSources(): Promise<void> {
    await Promise.all(this.videoLayers.map((clip) => clip.openSource()));
  }

  disposeLayerSources(): void {
    for (const clip of this.videoLayers) {
      clip.disposeSource();
    }
  }

  getFrameContextAtTime(
    time: number,
    frame = Math.floor(time * this.fps),
    frameDurationUs = Math.round(1_000_000 / this.fps),
    durations: ClipDurationOverrides = new Map(),
  ): RenderFrameContext {
    const layers = this.layerList
      .map((clip) => this.createLayerContext(clip, time, frame, durations.get(clip)))
      .filter((clip): clip is LayerClip => clip !== null);

    const videos = layers.filter((clip): clip is VideoLayerClip => clip.type === 'video');
    const images = layers.filter((clip): clip is ImageLayerClip => clip.type === 'image');

    return {
      frame,
      time,
      timestampUs: frame * frameDurationUs,
      layers,
      videos,
      images,
    };
  }

  private createLayerContext(
    clip: LayerClipDefinition,
    time: number,
    frame: number,
    duration: number | undefined,
  ): LayerClip | null {
    if (!clip.containsTime(time, duration)) {
      return null;
    }

    const localTime = clip.localTimeAt(time);

    if (clip.type === 'video') {
      return {
        type: 'video',
        clip,
        localTime,
        sourceTime: localTime,
        nextSourceFrame: () => clip.nextSourceFrame(localTime, frame),
      };
    }

    return {
      type: 'image',
      clip,
      localTime,
    };
  }
}

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

export interface RenderFrameContext {
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
