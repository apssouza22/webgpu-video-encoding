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
  private readonly videoLayers: VideoLayerElement[];
  private readonly imageLayers: ImageLayerElement[];
  private animationFrame: number | null = null;

  constructor(
    private readonly composition: Composition,
    container: HTMLElement,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'composition-player';
    this.root.style.aspectRatio = `${composition.width} / ${composition.height}`;

    this.videoLayers = composition.videoLayers.map((clip) => this.createVideoLayer(clip));
    this.imageLayers = composition.imageLayers.map((clip) => this.createImageLayer(clip));

    for (const {element} of this.videoLayers) {
      this.root.appendChild(element);
    }

    for (const {element} of this.imageLayers) {
      this.root.appendChild(element);
    }

    container.replaceChildren(this.root);
    this.updateLayers();
  }

  get primaryVideo(): HTMLVideoElement | null {
    return this.videoLayers[0]?.element ?? null;
  }

  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private createVideoLayer(clip: VideoClip): VideoLayerElement {
    const element = document.createElement('video');
    element.src = clip.url;
    element.controls = true;
    element.playsInline = true;
    element.preload = 'metadata';
    element.className = 'composition-player__video composition-player__layer';
    this.applyLayerBounds(element, clip);

    element.addEventListener('play', () => this.startLayerUpdates());
    element.addEventListener('pause', () => this.stopLayerUpdates());
    element.addEventListener('ended', () => this.stopLayerUpdates());
    element.addEventListener('seeked', () => this.updateLayers());
    element.addEventListener('timeupdate', () => this.updateLayers());

    return {clip, element};
  }

  private createImageLayer(clip: ImageClip): ImageLayerElement {
    const element = document.createElement('img');
    element.src = clip.url;
    element.alt = 'Composition overlay';
    element.className = 'composition-player__image composition-player__layer';
    element.style.opacity = `${clip.opacity}`;
    this.applyLayerBounds(element, clip);

    return {clip, element};
  }

  private applyLayerBounds(element: HTMLElement, clip: VideoClip | ImageClip): void {
    element.style.left = `${clip.x * 100}%`;
    element.style.top = `${clip.y * 100}%`;
    element.style.width = `${clip.width * 100}%`;
    element.style.height = `${clip.height * 100}%`;
  }

  private startLayerUpdates(): void {
    if (this.animationFrame !== null) {
      return;
    }

    const update = () => {
      this.updateLayers();
      this.animationFrame = requestAnimationFrame(update);
    };

    this.animationFrame = requestAnimationFrame(update);
  }

  private stopLayerUpdates(): void {
    if (this.animationFrame === null) {
      return;
    }

    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.updateLayers();
  }

  private updateLayers(): void {
    const time = this.primaryVideo?.currentTime ?? 0;

    for (const {clip, element} of this.imageLayers) {
      element.hidden = !clip.containsTime(time);
    }
  }
}
