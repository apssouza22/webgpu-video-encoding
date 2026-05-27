import type {Composition} from '../composition';
import type {ExportProgress, VideoClip, VideoFrameContext} from '../types';
import {ExporterCanvas} from '../gpu/ExporterCanvas';
import {GpuCompositor} from '../gpu/GpuCompositor';
import {FrameRender} from './FrameRender';
import {VideoEncoderService} from './VideoEncoderService';

export type VideoExportProgressCallback = (progress: ExportProgress) => void;

export interface VideoExportSettings {
  composition: Composition;
  videoEncoder: VideoEncoderService;
  hasAudio: boolean;
  onProgress: VideoExportProgressCallback;
}

export class VideoExport {
  private constructor(
    private readonly composition: Composition,
    private readonly frameRender: FrameRender,
    private readonly exportCanvas: ExporterCanvas,
    private readonly compositor: GpuCompositor,
    private readonly totalFrames: number,
    private readonly hasAudio: boolean,
    private readonly onProgress: VideoExportProgressCallback,
  ) {}

  static async create(settings: VideoExportSettings): Promise<VideoExport> {
    const device = await this.createGpuDevice();
    const exportCanvas = new ExporterCanvas();
    let compositor: GpuCompositor | null = null;

    try {
      const composition = settings.composition;
      const frameDurationUs = Math.round(1_000_000 / composition.fps);
      const canvasContext = exportCanvas.init(device, composition.width, composition.height);
      compositor = await GpuCompositor.create(device, exportCanvas.getFormat());
      const frameRender = new FrameRender({
        frameDurationUs,
        compositor,
        canvasContext,
        exportCanvas,
        device,
        videoEncoder: settings.videoEncoder,
      });

      return new VideoExport(
        composition,
        frameRender,
        exportCanvas,
        compositor,
        Math.ceil(composition.duration * composition.fps),
        settings.hasAudio,
        settings.onProgress,
      );
    } catch (error) {
      compositor?.destroy();
      exportCanvas.destroy();
      throw error;
    }
  }

  static async createEncoder(
    composition: Composition,
    hasAudio: boolean,
  ): Promise<VideoEncoderService> {
    const videoEncoder = new VideoEncoderService({
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      bitrate: 8_000_000,
      hasAudio,
    });
    await videoEncoder.init();

    return videoEncoder;
  }

  async render(): Promise<void> {
    const framesList = this.composition.getAllFrames();
    await this.bindVideoFrameStreams(framesList);

    for (const frame of framesList) {
      await this.frameRender.renderAndEncode(frame);
      this.reportProgress(frame.frame);
    }
  }

  destroy(): void {
    this.compositor.destroy();
    this.exportCanvas.destroy();
  }

  private static async createGpuDevice(): Promise<GPUDevice> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire GPU adapter');
    }

    return adapter.requestDevice();
  }

  private async bindVideoFrameStreams(videoFrames: VideoFrameContext[]): Promise<void> {
    const clips = this.getVideoClips(videoFrames);
    await Promise.all(
        Array.from(clips, (clip) => clip.bindFrameStream(videoFrames)),
    );
  }

  private getVideoClips(videoFrames: VideoFrameContext[]) {
    const clips = new Set<VideoClip>();

    for (const context of videoFrames) {
      for (const videoLayer of context.videos) {
        clips.add(videoLayer.clip);
      }
    }

    return clips;
  }

  private reportProgress(frame: number): void {
    const encodedFrames = frame + 1;
    const percent = (encodedFrames / this.totalFrames) * (this.hasAudio ? 95 : 100);

    this.onProgress({
      phase: 'video',
      frame: encodedFrames,
      totalFrames: this.totalFrames,
      percent,
      message: `GPU frame ${encodedFrames}/${this.totalFrames}`,
    });
  }
}
