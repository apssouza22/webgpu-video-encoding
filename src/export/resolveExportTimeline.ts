import type { Clip, ClipDurationOverrides, Composition, ImageClip, VideoClip } from '../types';

export interface ResolvedExportTimeline {
  /** Timeline length in seconds */
  duration: number;
  /** Resolved layer durations keyed by clip instance */
  clipDurations: ClipDurationOverrides;
  /** Seconds of video active on the timeline */
  videoDuration: number;
  /** Seconds of image overlay active on the timeline */
  imageDuration: number;
  /** Seconds of audio to decode from the audio clip */
  audioDuration: number;
}

function clipLength(declared: number, available: number): number {
  if (available <= 0) {
    return declared > 0 ? declared : 0;
  }
  if (declared <= 0) {
    return available;
  }
  return Math.min(declared, available);
}

function resolveVideoDuration(clip: VideoClip): number {
  return clipLength(clip.duration, clip.sourceDuration);
}

function resolveImageDuration(clip: ImageClip): number {
  return Math.max(0, clip.duration);
}

function resolveClipDuration(clip: Clip): number {
  return clip.type === 'video'
    ? resolveVideoDuration(clip as VideoClip)
    : resolveImageDuration(clip as ImageClip);
}

/**
 * Derive export length from composition clips and loaded source media.
 * Clip durations <= 0 mean "use all available media from start".
 * Composition.duration <= 0 means "derive from clips and media only".
 */
export function resolveExportTimeline(composition: Composition): ResolvedExportTimeline {
  const clipDurations = new Map<Clip, number>();
  const clipEnds = composition.layers.map((clip) => {
    const duration = resolveClipDuration(clip);
    clipDurations.set(clip, duration);
    return clip.timelineEnd(duration);
  });
  const derivedDuration = Math.max(...clipEnds, 0);
  const duration =
    composition.duration > 0
      ? Math.max(composition.duration, derivedDuration)
      : derivedDuration;
  const videoDuration = composition.video ? (clipDurations.get(composition.video) ?? 0) : 0;
  const imageDuration = composition.image ? (clipDurations.get(composition.image) ?? 0) : 0;

  return {
    duration,
    clipDurations,
    videoDuration,
    imageDuration,
    audioDuration: videoDuration,
  };
}
