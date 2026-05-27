import {AudioClip, Composition, ImageClip, VideoClip} from './types';

export { AudioClip, Composition, ImageClip, VideoClip } from './types';


/**
 * Demo timeline: video layers, image overlays, and an explicit MP4-backed audio clip.
 * Durations <= 0 are resolved from loaded source media length.
 */
export const DEMO_COMPOSITION = new Composition(30, 1280, 720, {
  outputFilename: 'composition-export.mp4',
})
  .addLayer(new VideoClip('/samples/video.mp4', 0, 5))
  .addLayer(new VideoClip('/samples/video-2.mp4', 5))
  .addLayer(new AudioClip('/samples/video.mp4', 0, 5))
  .addLayer(new ImageClip('/samples/overlay.png', 1, 3, 0.62, 0.08, 0.32, 0.32, 0.92))
  .addLayer(new ImageClip('/samples/overlay-2.png', 1, 3, 0, 0.08, 0.32, 0.32, 0.92));
