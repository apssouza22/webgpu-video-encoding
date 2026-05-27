import {GpuCompositor} from '../gpu/GpuCompositor';
import type {Composition, ImageClip, VideoClip} from '../types';

interface VideoLayerElement {
  clip: VideoClip;
  element: HTMLVideoElement;
}

interface ImageLayerElement {
  clip: ImageClip;
  element: HTMLImageElement;
}

export class CompositionPlayer {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly canvasContext: GPUCanvasContext;
  private readonly compositor: GpuCompositor;
  private readonly videoLayers: VideoLayerElement[];
  private readonly imageLayers: ImageLayerElement[];
  private readonly playButton: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly timeLabel: HTMLSpanElement;
  private animationFrame: number | null = null;
  private videoFrameCallback: number | null = null;

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

    this.videoLayers = composition.videoLayers.map((clip) => this.createVideoLayer(clip));
    this.imageLayers = composition.imageLayers.map((clip) => this.createImageLayer(clip));

    this.root.appendChild(this.canvas);
    for (const {element} of this.videoLayers) {
      this.root.appendChild(element);
    }
    this.root.appendChild(this.createControls());

    container.replaceChildren(this.root);
    this.updateControls();
  }

  get primaryVideo(): HTMLVideoElement | null {
    return this.videoLayers[0]?.element ?? null;
  }

  pause(): void {
    this.primaryVideo?.pause();
  }

  destroy(): void {
    this.cancelScheduledRender();

    this.compositor.destroy();
  }

  private createVideoLayer(clip: VideoClip): VideoLayerElement {
    const element = document.createElement('video');
    element.src = clip.url;
    element.controls = false;
    element.playsInline = true;
    element.preload = 'metadata';
    element.className = 'composition-player__source-video';

    element.addEventListener('play', () => this.startLayerUpdates());
    element.addEventListener('pause', () => this.stopLayerUpdates());
    element.addEventListener('ended', () => this.stopLayerUpdates());
    element.addEventListener('loadedmetadata', () => {
      this.updateDuration();
      void this.renderCurrentFrame();
    });
    element.addEventListener('loadeddata', () => void this.renderCurrentFrame());
    element.addEventListener('canplay', () => void this.renderCurrentFrame());
    element.addEventListener('seeked', () => {
      this.updateControls();
      void this.renderCurrentFrame();
    });
    element.addEventListener('timeupdate', () => this.updateControls());

    return {clip, element};
  }

  private createImageLayer(clip: ImageClip): ImageLayerElement {
    const element = document.createElement('img');
    element.src = clip.url;
    element.alt = 'Composition overlay';
    element.className = 'composition-player__source-image';
    element.addEventListener('load', () => void this.renderCurrentFrame());

    return {clip, element};
  }

  private createControls(): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'composition-player__controls';

    this.playButton.addEventListener('click', () => {
      const video = this.primaryVideo;
      if (!video) {
        return;
      }

      if (video.paused) {
        void video.play();
      } else {
        video.pause();
      }
    });

    this.scrubber.addEventListener('input', () => {
      const video = this.primaryVideo;
      if (!video) {
        return;
      }

      video.currentTime = Number(this.scrubber.value);
      this.updateControls();
    });

    controls.append(this.playButton, this.scrubber, this.timeLabel);
    return controls;
  }

  private startLayerUpdates(): void {
    if (this.animationFrame !== null) {
      return;
    }

    this.playButton.textContent = 'Pause';
    this.scheduleNextRender();
  }

  private stopLayerUpdates(): void {
    this.cancelScheduledRender();
    this.playButton.textContent = 'Play';
    this.updateControls();
    void this.renderCurrentFrame();
  }

  private updateDuration(): void {
    const video = this.primaryVideo;
    const duration = video && Number.isFinite(video.duration)
      ? video.duration
      : this.composition.duration;

    this.scrubber.max = `${Math.max(duration, 0)}`;
    this.updateControls();
  }

  private updateControls(): void {
    const video = this.primaryVideo;
    const currentTime = video?.currentTime ?? 0;
    const duration = Number(this.scrubber.max) || this.composition.duration;

    this.scrubber.value = `${currentTime}`;
    this.timeLabel.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
  }

  private scheduleNextRender(): void {
    const video = this.primaryVideo;
    if (!video || video.paused || video.ended) {
      return;
    }

    if ('requestVideoFrameCallback' in video) {
      if (this.videoFrameCallback !== null) {
        return;
      }

      this.videoFrameCallback = video.requestVideoFrameCallback(async () => {
        this.videoFrameCallback = null;
        await this.renderCurrentFrame();
        this.scheduleNextRender();
      });
      return;
    }

    if (this.animationFrame !== null) {
      return;
    }

    this.animationFrame = requestAnimationFrame(async () => {
      this.animationFrame = null;
      await this.renderCurrentFrame();
      this.scheduleNextRender();
    });
  }

  private cancelScheduledRender(): void {
    const video = this.primaryVideo;
    if (this.videoFrameCallback !== null && video && 'cancelVideoFrameCallback' in video) {
      video.cancelVideoFrameCallback(this.videoFrameCallback);
    }
    this.videoFrameCallback = null;

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private async renderCurrentFrame(): Promise<void> {
    const video = this.primaryVideo;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    this.updateControls();

    const sourceFrame = new VideoFrame(video, {
      timestamp: Math.round(video.currentTime * 1_000_000),
    });
    const imageLayer = this.currentImageLayer(video.currentTime);

    try {
      await this.compositor.renderFrame(this.canvasContext, {
        time: video.currentTime,
        videoFrame: sourceFrame,
        overlayImage: imageLayer?.element.complete ? imageLayer.element : null,
        imageClip: imageLayer?.clip ?? null,
      });
    } finally {
      sourceFrame.close();
    }
  }

  private currentImageLayer(time: number): ImageLayerElement | null {
    return this.imageLayers.find(({clip}) => clip.containsTime(time)) ?? null;
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
