import type { Composition } from './types';

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
