import type { VideoFrameContext } from '../types';
import { ExportCanvas } from '../gpu/ExportCanvas';
import { GpuCompositor } from '../gpu/GpuCompositor';
import { VideoEncoderService } from './VideoEncoderService';
import type { DecodedVideoFrame } from '../media/VideoFrameSource';

export interface FrameRenderOptions {
  frameDurationUs: number;
  compositor: GpuCompositor;
  canvasContext: GPUCanvasContext;
  exportCanvas: ExportCanvas;
  device: GPUDevice;
  videoEncoder: VideoEncoderService;
}

export class FrameRender {
  private readonly frameDurationUs: number;
  private readonly gpuCompositor: GpuCompositor;
  private readonly canvasContext: GPUCanvasContext;
  private readonly exportCanvas: ExportCanvas;
  private readonly device: GPUDevice;
  private readonly videoEncoder: VideoEncoderService;

  constructor(options: FrameRenderOptions) {
    this.frameDurationUs = options.frameDurationUs;
    this.gpuCompositor = options.compositor;
    this.canvasContext = options.canvasContext;
    this.exportCanvas = options.exportCanvas;
    this.device = options.device;
    this.videoEncoder = options.videoEncoder;
  }

  async renderAndEncode(frameContext: VideoFrameContext): Promise<void> {
    if (frameContext.videos.length === 0) {
      throw new Error(`No video clip is active at ${frameContext.time.toFixed(3)}s`);
    }

    const sourceFrame = await this.nextSourceFrame(frameContext);

    try {
      await this.renderFrame(frameContext, sourceFrame.frame);
      await this.encodeFrame(frameContext);
    } finally {
      sourceFrame.close();
    }
  }

  private async nextSourceFrame(context: VideoFrameContext): Promise<DecodedVideoFrame> {
    const videoLayer = context.videos[0];
    if (!videoLayer) {
      throw new Error(`No video clip is active at ${context.time.toFixed(3)}s`);
    }

    return videoLayer.nextSourceFrame();
  }

  private async renderFrame(context: VideoFrameContext, videoFrame: VideoFrame): Promise<void> {
    const imageLayer = context.images[0] ?? null;
    const overlayImage = imageLayer ? await imageLayer.clip.loadImageElement() : null;

    await this.gpuCompositor.renderFrame(this.canvasContext, {
      time: context.time,
      videoFrame,
      overlayImage,
      imageClip: imageLayer?.clip ?? null,
    });
  }

  private async encodeFrame(context: VideoFrameContext): Promise<void> {
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
}
