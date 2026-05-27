import {GpuCompositor} from '../gpu/GpuCompositor';
import type {Composition, ImageClip} from '../types';

export class CompositionPlayer {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasContext: GPUCanvasContext;
  private readonly compositor: GpuCompositor;
  private readonly imageLayers: ImageClip[];
  private readonly playButton: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly timeLabel: HTMLSpanElement;
  private animationFrame: number | null = null;
  private currentTime = 0;
  private isPlaying = false;
  private playStartedAt = 0;
  private playStartedTime = 0;
  private renderVersion = 0;

  static async create(
    composition: Composition,
    container: HTMLElement,
  ): Promise<CompositionPlayer> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire GPU adapter');
    }

    const device = await adapter.requestDevice();
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const compositor = await GpuCompositor.create(device, canvasFormat);

    return new CompositionPlayer(composition, container, device, canvasFormat, compositor);
  }

  private constructor(
    private readonly composition: Composition,
    container: HTMLElement,
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    compositor: GpuCompositor,
  ) {
    this.compositor = compositor;
    this.root = document.createElement('div');
    this.root.className = 'composition-player';

    this.canvas = document.createElement('canvas');
    this.canvas.width = composition.width;
    this.canvas.height = composition.height;
    this.canvas.className = 'composition-player__canvas';

    const canvasContext = this.canvas.getContext('webgpu');
    if (!canvasContext) {
      throw new Error('WebGPU canvas context not available');
    }

    canvasContext.configure({
      device,
      format: canvasFormat,
      alphaMode: 'premultiplied',
    });
    this.canvasContext = canvasContext;

    this.playButton = document.createElement('button');
    this.playButton.type = 'button';
    this.playButton.textContent = 'Play';

    this.scrubber = document.createElement('input');
    this.scrubber.type = 'range';
    this.scrubber.min = '0';
    this.scrubber.max = `${Math.max(composition.duration, 0)}`;
    this.scrubber.step = '0.001';
    this.scrubber.value = '0';

    this.timeLabel = document.createElement('span');
    this.timeLabel.className = 'composition-player__time';

    this.imageLayers = composition.imageLayers;

    this.root.appendChild(this.canvas);
    this.root.appendChild(this.createControls());

    container.replaceChildren(this.root);
    this.updateControls();
    void this.renderCurrentFrame();
  }

  pause(): void {
    this.pausePlayback();
  }

  destroy(): void {
    this.pausePlayback();
    this.compositor.destroy();
  }

  private createControls(): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'composition-player__controls';

    this.playButton.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pausePlayback();
      } else {
        this.startPlayback();
      }
    });

    this.scrubber.addEventListener('input', () => {
      this.currentTime = Number(this.scrubber.value);
      if (this.isPlaying) {
        this.playStartedAt = performance.now();
        this.playStartedTime = this.currentTime;
      }
      this.updateControls();
      void this.renderCurrentFrame();
    });

    controls.append(this.playButton, this.scrubber, this.timeLabel);
    return controls;
  }

  private startPlayback(): void {
    if (this.currentTime >= this.duration) {
      this.currentTime = 0;
    }

    this.isPlaying = true;
    this.playStartedAt = performance.now();
    this.playStartedTime = this.currentTime;
    this.playButton.textContent = 'Pause';
    this.schedulePlaybackFrame();
  }

  private pausePlayback(): void {
    if (this.isPlaying) {
      this.currentTime = this.playbackTime();
    }

    this.isPlaying = false;
    this.cancelPlaybackFrame();
    this.playButton.textContent = 'Play';
    this.updateControls();
  }

  private updateControls(): void {
    this.scrubber.max = `${this.duration}`;
    this.scrubber.value = `${this.currentTime}`;
    this.timeLabel.textContent = `${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}`;
  }

  private schedulePlaybackFrame(): void {
    if (!this.isPlaying || this.animationFrame !== null) {
      return;
    }

    this.animationFrame = requestAnimationFrame(async () => {
      this.animationFrame = null;
      if (!this.isPlaying) {
        return;
      }

      this.currentTime = this.playbackTime();
      if (this.currentTime >= this.duration) {
        this.currentTime = this.duration;
        this.pausePlayback();
        return;
      }

      await this.renderCurrentFrame();
      this.schedulePlaybackFrame();
    });
  }

  private cancelPlaybackFrame(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private playbackTime(): number {
    return Math.min(
      this.duration,
      this.playStartedTime + (performance.now() - this.playStartedAt) / 1000,
    );
  }

  private async renderCurrentFrame(): Promise<void> {
    const renderVersion = ++this.renderVersion;
    const renderTime = Math.min(this.currentTime, Math.max(0, this.duration - 0.001));
    const frameContext = this.composition.getFrameContextAtTime(renderTime);
    const videoLayer = frameContext.videos[0];
    if (!videoLayer) {
      return;
    }

    this.updateControls();

    const sourceFrame = await videoLayer.clip.nextSourceFrame(
      videoLayer.sourceTime,
      frameContext.frame,
    );
    const imageLayer = this.currentImageLayer(renderTime);
    const overlayImage = imageLayer ? await imageLayer.loadImageElement() : null;

    try {
      if (renderVersion !== this.renderVersion) {
        return;
      }

      await this.compositor.renderFrame(this.canvasContext, {
        time: renderTime,
        videoFrame: sourceFrame.frame,
        overlayImage,
        imageClip: imageLayer,
      });
    } finally {
      sourceFrame.close();
    }
  }

  private currentImageLayer(time: number): ImageClip | null {
    return this.imageLayers.find((clip) => clip.containsTime(time)) ?? null;
  }

  private get duration(): number {
    return Math.max(this.composition.duration, 0);
  }

  private formatTime(time: number): string {
    if (!Number.isFinite(time)) {
      return '0:00';
    }

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
}
