import { MediaBunnyMuxer } from './MediaBunnyMuxer';
import { resolveVideoEncoderConfig } from './codecHelpers';

export interface VideoEncoderSettings {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  hasAudio: boolean;
}

export class VideoEncoderService {
  private encoder: VideoEncoder | null = null;
  private muxer: MediaBunnyMuxer;
  private settings: VideoEncoderSettings;
  private frameCount = 0;
  private activeCodec = '';
  private readonly maxEncodeQueueSize = 8;

  constructor(settings: VideoEncoderSettings) {
    this.settings = settings;
    this.muxer = new MediaBunnyMuxer({
      fps: settings.fps,
      hasAudio: settings.hasAudio,
    });
  }

  async init(): Promise<void> {
    if (!('VideoEncoder' in window)) {
      throw new Error('WebCodecs VideoEncoder is not supported in this browser');
    }

    const { config, codec } = await resolveVideoEncoderConfig(
      this.settings.width,
      this.settings.height,
      this.settings.fps,
      this.settings.bitrate,
    );
    this.activeCodec = codec;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        this.muxer.addVideoChunk(chunk, meta);
      },
      error: (error) => {
        throw error;
      },
    });

    this.encoder.configure(config);
    console.info(`[VideoEncoder] Using ${codec}`, config);
  }

  getActiveCodec(): string {
    return this.activeCodec;
  }

  async encodeVideoFrame(frame: VideoFrame, frameIndex: number): Promise<void> {
    if (!this.encoder) {
      throw new Error('VideoEncoder not initialized');
    }

    const keyFrame = frameIndex % this.settings.fps === 0;
    this.encoder.encode(frame, { keyFrame });
    this.frameCount++;

    if (this.encoder.encodeQueueSize >= this.maxEncodeQueueSize) {
      await this.waitForEncoderDrain(this.encoder);
      return;
    }

    if (frameIndex % 30 === 0) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    this.muxer.addAudioChunk(chunk, meta);
  }

  async finish(): Promise<Blob> {
    if (!this.encoder) {
      throw new Error('VideoEncoder not initialized');
    }

    await this.encoder.flush();
    this.encoder.close();
    this.encoder = null;

    const buffer = await this.muxer.finalize();
    return new Blob([buffer], { type: 'video/mp4' });
  }

  private async waitForEncoderDrain(encoder: VideoEncoder): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(resolveOnce, 50);

      function resolveOnce() {
        window.clearTimeout(timeoutId);
        encoder.removeEventListener('dequeue', resolveOnce);
        resolve();
      }

      encoder.addEventListener('dequeue', resolveOnce, { once: true });
    });
  }
}
