import {GpuCompositor} from '../gpu/GpuCompositor';
import {PlayerCanvas} from '../gpu/PlayerCanvas';
import type {Composition} from '../composition';
import type {ImageClip} from '../types';
import {AudioPlayer} from './AudioPlayer';

export class CompositionPlayer {
  private readonly root: HTMLElement;
  private readonly playerCanvas: PlayerCanvas;
  private readonly compositor: GpuCompositor;
  private readonly audioPlayer: AudioPlayer;
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
    const playerCanvas = new PlayerCanvas();
    playerCanvas.init(device, composition.width, composition.height);
    const compositor = await GpuCompositor.create(device, playerCanvas.getFormat());
    const audioPlayer = await AudioPlayer.create(composition.audioLayers);

    return new CompositionPlayer(composition, container, playerCanvas, compositor, audioPlayer);
  }

  private constructor(
    private readonly composition: Composition,
    container: HTMLElement,
    playerCanvas: PlayerCanvas,
    compositor: GpuCompositor,
    audioPlayer: AudioPlayer,
  ) {
    this.playerCanvas = playerCanvas;
    this.compositor = compositor;
    this.audioPlayer = audioPlayer;
    this.root = document.createElement('div');
    this.root.className = 'composition-player';
    const canvas = this.playerCanvas.getCanvas();
    canvas.className = 'composition-player__canvas';

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

    this.root.appendChild(canvas);
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
    this.audioPlayer.destroy();
    this.compositor.destroy();
    this.playerCanvas.destroy();
  }

  private createControls(): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'composition-player__controls';

    this.playButton.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pausePlayback();
      } else {
        void this.startPlayback();
      }
    });

    this.scrubber.addEventListener('input', () => {
      this.currentTime = Number(this.scrubber.value);
      if (this.isPlaying) {
        this.playStartedAt = performance.now();
        this.playStartedTime = this.currentTime;
        this.audioPlayer.seek(this.currentTime);
      }
      this.updateControls();
      void this.renderCurrentFrame();
    });

    controls.append(this.playButton, this.scrubber, this.timeLabel);
    return controls;
  }

  private async startPlayback(): Promise<void> {
    if (this.currentTime >= this.duration) {
      this.currentTime = 0;
    }

    this.isPlaying = true;
    this.playStartedAt = performance.now();
    this.playStartedTime = this.currentTime;
    this.playButton.textContent = 'Pause';

    try {
      await this.audioPlayer.play(this.currentTime);
    } catch (error) {
      console.warn('Audio preview playback failed', error);
      this.pausePlayback();
      return;
    }

    this.schedulePlaybackFrame();
  }

  private pausePlayback(): void {
    if (this.isPlaying) {
      this.currentTime = this.playbackTime();
    }

    this.isPlaying = false;
    this.cancelPlaybackFrame();
    this.audioPlayer.pause();
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
    const imageLayers = this.currentImageLayers(renderTime);
    const overlays = await Promise.all(
      imageLayers.map(async (imageClip) => ({
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

  private currentImageLayers(time: number): ImageClip[] {
    return this.imageLayers.filter((clip) => clip.containsTime(time));
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
