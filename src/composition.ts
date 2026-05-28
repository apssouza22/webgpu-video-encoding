import {
  AudioClip,
  ImageClip,
  VideoClip,
  type CompositionOptions,
  type ImageLayerClip,
  type LayerClip,
  type LayerClipDefinition,
  type VideoFrameContext,
  type VideoLayerClip,
} from './types';

export {AudioClip, ImageClip, VideoClip} from './types';

export class Composition {
  private readonly layerList: LayerClipDefinition[] = [];
  private readonly requestedDuration: number;

  readonly outputFilename: string;

  constructor(
    readonly fps: number,
    readonly width: number,
    readonly height: number,
    options: CompositionOptions = {},
  ) {
    this.requestedDuration = options.duration ?? 0;
    this.outputFilename = options.outputFilename ?? 'composition-export.mp4';
  }

  addLayer<T extends LayerClipDefinition>(clip: T): this {
    this.layerList.push(clip);
    return this;
  }

  get layers(): readonly LayerClipDefinition[] {
    return this.layerList;
  }

  get duration(): number {
    const clipEnds = this.layerList.map((clip) => clip.timelineEnd());
    const derivedDuration = Math.max(...clipEnds, 0);

    return this.requestedDuration > 0
      ? Math.max(this.requestedDuration, derivedDuration)
      : derivedDuration;
  }

  get videoLayers(): VideoClip[] {
    return this.layerList.filter((clip): clip is VideoClip => clip.type === 'video');
  }

  get imageLayers(): ImageClip[] {
    return this.layerList.filter((clip): clip is ImageClip => clip.type === 'image');
  }

  get audioLayers(): AudioClip[] {
    return this.layerList.filter((clip): clip is AudioClip => clip.type === 'audio');
  }

  get video(): VideoClip | null {
    return this.videoLayers[0] ?? null;
  }

  get image(): ImageClip | null {
    return this.imageLayers[0] ?? null;
  }

  get audio(): AudioClip | null {
    return this.audioLayers[0] ?? null;
  }

  async loadVideoSources(): Promise<void> {
    await Promise.all(this.videoLayers.map((clip) => clip.openVideoSource()));
  }

  async loadImageSources(): Promise<void> {
    await Promise.all(this.imageLayers.map((clip) => clip.loadImageElement()));
  }

  async loadAudioSources(): Promise<void> {
    await Promise.all(this.audioLayers.map((clip) => clip.openAudioSource()));
  }

  async loadLayerSources(): Promise<void> {
    await Promise.all([
      this.loadVideoSources(),
      this.loadImageSources(),
      this.loadAudioSources(),
    ]);
  }

  disposeLayerSources(): void {
    for (const clip of this.videoLayers) {
      clip.disposeSource();
    }

    for (const clip of this.imageLayers) {
      clip.disposeImage();
    }

    for (const clip of this.audioLayers) {
      clip.disposeSource();
    }
  }

  getFrameContextAtTime(
    time: number,
    frame = Math.floor(time * this.fps),
    frameDurationUs = Math.round(1_000_000 / this.fps),
  ): VideoFrameContext {
    const layers = this.layerList
      .map((clip) => this.createLayerContext(clip, time, frame))
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
  ): LayerClip | null {
    if (clip.type === 'audio') {
      return null;
    }

    if (!clip.containsTime(time)) {
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

  getAllFrames(): VideoFrameContext[] {
    const totalFrames = Math.ceil(this.duration * this.fps);
    const frameDurationUs = Math.round(1_000_000 / this.fps);
    return Array.from({length: totalFrames}, (_, frame) => {
      const time = frame / this.fps;
      return this.getFrameContextAtTime(time, frame, frameDurationUs);
    });
  }
}

/**
 * Demo timeline: video layers, image overlays, and an explicit MP4-backed audio clip.
 * Durations <= 0 are resolved from loaded source media length.
 */
const demoAssetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

export const DEMO_COMPOSITION = new Composition(30, 1280, 720, {
  outputFilename: 'composition-export.mp4',
})
  .addLayer(new VideoClip(demoAssetUrl('samples/video.mp4'), 0, 5))
  .addLayer(new VideoClip(demoAssetUrl('samples/video-2.mp4'), 5))
  .addLayer(new AudioClip(demoAssetUrl('samples/video-2.mp4'), 5))
  .addLayer(new AudioClip(demoAssetUrl('samples/video.mp4'), 0, 5))
  .addLayer(new ImageClip(demoAssetUrl('samples/overlay.png'), 1, 3, 0.62, 0.08, 0.32, 0.32, 0.92))
  .addLayer(new ImageClip(demoAssetUrl('samples/overlay-2.png'), 1, 3, 0, 0.08, 0.32, 0.32, 0.92));
