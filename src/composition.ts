import type { VideoFrameContext } from './types';
import { Composition, ImageClip, VideoClip } from './types';

export { Composition, ImageClip, VideoClip } from './types';


export function buildRenderFrameContext(
  composition: Composition,
  frame: number,
  frameDurationUs: number,
): VideoFrameContext {
  const time = frame / composition.fps;
  return composition.getFrameContextAtTime(time, frame, frameDurationUs);
}

/**
 * Demo timeline: base video layer, image overlay from t=2s, audio from the video clip.
 * Durations <= 0 are resolved from loaded source media length.
 */
export const DEMO_COMPOSITION = new Composition(30, 1280, 720, {
  outputFilename: 'composition-export.mp4',
})
  .addLayer(new VideoClip('/samples/video.mp4', 0))
  .addLayer(new ImageClip('/samples/overlay.png', 2, 3, 0.62, 0.08, 0.32, 0.32, 0.92));
