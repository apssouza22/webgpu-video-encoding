import type { ExportProgress, RenderFrameContext } from '../types';
import { ExportCanvas } from '../gpu/ExportCanvas';
import { GpuCompositor } from '../gpu/GpuCompositor';
import { VideoEncoderService } from './VideoEncoderService';
import type { DecodedVideoFrame } from '../media/VideoFrameSource';

export interface FrameRenderOptions {
  frameDurationUs: number;
  sourceFrames: AsyncGenerator<DecodedVideoFrame>;
  compositor: GpuCompositor;
  canvasContext: GPUCanvasContext;
  overlay: HTMLImageElement;
  exportCanvas: ExportCanvas;
  device: GPUDevice;
  videoEncoder: VideoEncoderService;
  totalFrames: number;
  includeAudio: boolean;
  onProgress: (progress: ExportProgress) => void;
}

export class FrameRender {
  private readonly frameDurationUs: number;
  private readonly sourceFrames: AsyncGenerator<DecodedVideoFrame>;
  private readonly compositor: GpuCompositor;
  private readonly canvasContext: GPUCanvasContext;
  private readonly overlay: HTMLImageElement;
  private readonly exportCanvas: ExportCanvas;
  private readonly device: GPUDevice;
  private readonly videoEncoder: VideoEncoderService;
  private readonly totalFrames: number;
  private readonly includeAudio: boolean;
  private readonly onProgress: (progress: ExportProgress) => void;

  constructor(options: FrameRenderOptions) {
    this.frameDurationUs = options.frameDurationUs;
    this.sourceFrames = options.sourceFrames;
    this.compositor = options.compositor;
    this.canvasContext = options.canvasContext;
    this.overlay = options.overlay;
    this.exportCanvas = options.exportCanvas;
    this.device = options.device;
    this.videoEncoder = options.videoEncoder;
    this.totalFrames = options.totalFrames;
    this.includeAudio = options.includeAudio;
    this.onProgress = options.onProgress;
  }

  async renderAndEncode(context: RenderFrameContext): Promise<void> {
    if (!context.clips.video) {
      throw new Error(`No video clip is active at ${context.time.toFixed(3)}s`);
    }

    const sourceFrame = await this.nextSourceFrame(context.frame);

    try {
      await this.renderFrame(context, sourceFrame.frame);
      await this.encodeFrame(context);
      this.reportProgress(context.frame);
    } finally {
      sourceFrame.close();
    }
  }

  private async nextSourceFrame(frame: number): Promise<DecodedVideoFrame> {
    const result = await this.sourceFrames.next();
    if (result.done) {
      throw new Error(`MediaBunny video source ended before export frame ${frame}`);
    }
    return result.value;
  }

  private async renderFrame(context: RenderFrameContext, videoFrame: VideoFrame): Promise<void> {
    const imageLayer = context.clips.image;

    await this.compositor.renderFrame(this.canvasContext, {
      time: context.time,
      videoFrame,
      overlayImage: imageLayer ? this.overlay : null,
      imageClip: imageLayer?.clip ?? null,
    });
  }

  private async encodeFrame(context: RenderFrameContext): Promise<void> {
    const videoFrame = await this.exportCanvas.captureVideoFrame(
      this.device,
      context.timestampUs,
      this.frameDurationUs,
    );

    try {
      await this.videoEncoder.encodeVideoFrame(videoFrame, context.frame);
    } finally {
      videoFrame.close();
    }
  }

  private reportProgress(frame: number): void {
    const encodedFrames = frame + 1;
    const percent = (encodedFrames / this.totalFrames) * (this.includeAudio ? 95 : 100);

    this.onProgress({
      phase: 'video',
      frame: encodedFrames,
      totalFrames: this.totalFrames,
      percent,
      message: `GPU frame ${encodedFrames}/${this.totalFrames}`,
    });
  }
}
