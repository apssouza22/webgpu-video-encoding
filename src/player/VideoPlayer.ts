import type {Composition} from '../composition';
import {GpuCompositor} from '../gpu/GpuCompositor';
import {PlayerCanvas} from '../gpu/PlayerCanvas';
import type {ImageClip} from '../types';

export class VideoPlayer {
  private readonly playerCanvas: PlayerCanvas;
  private readonly compositor: GpuCompositor;
  private readonly imageLayers: readonly ImageClip[];
  private renderVersion = 0;

  static async create(composition: Composition): Promise<VideoPlayer> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire GPU adapter');
    }

    const device = await adapter.requestDevice();
    const playerCanvas = new PlayerCanvas();
    playerCanvas.init(device, composition.width, composition.height);
    const compositor = await GpuCompositor.create(device, playerCanvas.getFormat());

    return new VideoPlayer(composition, playerCanvas, compositor);
  }

  private constructor(
    private readonly composition: Composition,
    playerCanvas: PlayerCanvas,
    compositor: GpuCompositor,
  ) {
    this.playerCanvas = playerCanvas;
    this.compositor = compositor;
    this.imageLayers = composition.imageLayers;
  }

  getCanvas(): HTMLCanvasElement {
    return this.playerCanvas.getCanvas();
  }

  async render(time: number, duration: number): Promise<void> {
    const renderVersion = ++this.renderVersion;
    const renderTime = Math.min(time, Math.max(0, duration - 0.001));
    const frameContext = this.composition.getFrameContextAtTime(renderTime);
    const videoLayer = frameContext.videos[0];
    if (!videoLayer) {
      return;
    }

    const sourceFrame = await videoLayer.clip.nextSourceFrame(
      videoLayer.sourceTime,
      frameContext.frame,
    );
    const overlays = await Promise.all(
      this.currentImageLayers(renderTime).map(async (imageClip) => ({
        image: await imageClip.loadImageElement(),
        imageClip,
      })),
    );

    try {
      if (renderVersion !== this.renderVersion) {
        return;
      }

      await this.compositor.renderFrame(this.playerCanvas.getContext(), {
        time: renderTime,
        videoFrame: sourceFrame.frame,
        overlays,
      });
    } finally {
      sourceFrame.close();
    }
  }

  destroy(): void {
    this.compositor.destroy();
    this.playerCanvas.destroy();
  }

  private currentImageLayers(time: number): readonly ImageClip[] {
    return this.imageLayers.filter((clip) => clip.containsTime(time));
  }
}
