export interface VideoClip {
  url: string;
  start: number;
  /** Seconds to use from the source; <= 0 uses all available media from `start`. */
  duration: number;
}

export interface ImageClip {
  url: string;
  start: number;
  duration: number;
  /** Normalized top-left (0–1) */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface AudioClip {
  source: 'video';
  url: string;
  start: number;
  /** Seconds to export; <= 0 uses all available media from `start`. */
  duration: number;
}

export interface Composition {
  width: number;
  height: number;
  fps: number;
  /** Timeline length in seconds; <= 0 derives from clips and source media. */
  duration: number;
  outputFilename: string;
  video: VideoClip;
  image: ImageClip;
  audio: AudioClip;
}

export interface VideoLayerClip {
  type: 'video';
  clip: VideoClip;
  localTime: number;
  sourceTime: number;
}

export interface ImageLayerClip {
  type: 'image';
  clip: ImageClip;
  localTime: number;
}

export type LayerClip = VideoLayerClip | ImageLayerClip;

export interface CompositionClipsAtTime {
  layers: LayerClip[];
  video: VideoLayerClip | null;
  image: ImageLayerClip | null;
}

export interface RenderFrameContext {
  frame: number;
  time: number;
  timestampUs: number;
  clips: CompositionClipsAtTime;
}

export interface ExportProgress {
  phase: 'audio' | 'video' | 'mux';
  frame: number;
  totalFrames: number;
  percent: number;
  message: string;
}
