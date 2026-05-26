import type { Composition, ExportProgress } from '../types';
import { ExportCanvas } from '../gpu/ExportCanvas';
import { GpuCompositor } from '../gpu/GpuCompositor';
import { VideoEncoderService } from './VideoEncoderService';
import type { DecodedVideoFrame } from '../media/VideoFrameSource';

export interface FrameRenderOptions {
  composition: Composition;
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

interface FrameTiming {
  frame: number;
  time: number;
  timestampUs: number;
}

export class FrameRender {
  private readonly composition: Composition;
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
    this.composition = options.composition;
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

  async renderAndEncode(frame: number): Promise<void> {
    const timing = this.getFrameTiming(frame);
    const sourceFrame = await this.nextSourceFrame(frame);

    try {
      await this.renderFrame(timing.time, sourceFrame.frame);
      await this.encodeFrame(timing);
      this.reportProgress(frame);
    } finally {
      sourceFrame.close();
    }
  }

  private getFrameTiming(frame: number): FrameTiming {
    const time = frame / this.composition.fps;

    return {
      frame,
      time,
      timestampUs: frame * this.frameDurationUs,
    };
  }

  private async nextSourceFrame(frame: number): Promise<DecodedVideoFrame> {
    const result = await this.sourceFrames.next();
    if (result.done) {
      throw new Error(`MediaBunny video source ended before export frame ${frame}`);
    }
    return result.value;
  }

  private async renderFrame(time: number, videoFrame: VideoFrame): Promise<void> {
    await this.compositor.renderFrame(this.canvasContext, {
      time,
      videoFrame,
      overlayImage: this.overlay,
      imageClip: this.composition.image,
    });
  }

  private async encodeFrame(timing: FrameTiming): Promise<void> {
    const videoFrame = await this.exportCanvas.captureVideoFrame(
      this.device,
      timing.timestampUs,
      this.frameDurationUs,
    );

    try {
      await this.videoEncoder.encodeVideoFrame(videoFrame, timing.frame);
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
