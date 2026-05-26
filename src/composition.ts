import type {
  Composition,
  CompositionClipsAtTime,
  ImageLayerClip,
  RenderFrameContext,
  VideoLayerClip,
} from './types';

export interface CompositionClipDurations {
  video: number;
  image: number;
}

function containsTime(start: number, duration: number, time: number): boolean {
  return duration > 0 && time >= start && time < start + duration;
}

/**
 * Returns the active layer clips at a timeline time.
 * Clip activity is defined by [start, start + duration).
 */
export function getCompositionClipsAtTime(
  composition: Composition,
  time: number,
  durations: CompositionClipDurations,
): CompositionClipsAtTime {
  const layers: CompositionClipsAtTime['layers'] = [];
  let video: VideoLayerClip | null = null;
  let image: ImageLayerClip | null = null;

  if (containsTime(composition.video.start, durations.video, time)) {
    const localTime = time - composition.video.start;
    video = {
      type: 'video',
      clip: composition.video,
      localTime,
      sourceTime: localTime,
    };
    layers.push(video);
  }

  if (containsTime(composition.image.start, durations.image, time)) {
    image = {
      type: 'image',
      clip: composition.image,
      localTime: time - composition.image.start,
    };
    layers.push(image);
  }

  return { layers, video, image };
}

export function buildRenderFrameContext(
  composition: Composition,
  frame: number,
  frameDurationUs: number,
  durations: CompositionClipDurations,
): RenderFrameContext {
  const time = frame / composition.fps;

  return {
    frame,
    time,
    timestampUs: frame * frameDurationUs,
    clips: getCompositionClipsAtTime(composition, time, durations),
  };
}

/**
 * Demo timeline: base video, image overlay from t=2s, audio from the video clip.
 * Durations <= 0 are resolved at export time from the loaded source media length.
 */
export const DEMO_COMPOSITION: Composition = {
  width: 1280,
  height: 720,
  fps: 30,
  duration: 0,
  outputFilename: 'composition-export.mp4',
  video: {
    url: '/samples/video.mp4',
    start: 0,
    duration: 0,
  },
  image: {
    url: '/samples/overlay.png',
    start: 2,
    duration: 3,
    x: 0.62,
    y: 0.08,
    width: 0.32,
    height: 0.32,
    opacity: 0.92,
  },
  audio: {
    source: 'video',
    url: '/samples/video.mp4',
    start: 0,
    duration: 0,
  },
};
