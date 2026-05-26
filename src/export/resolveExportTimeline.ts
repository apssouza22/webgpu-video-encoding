import type { Composition } from '../types';

export interface ResolvedExportTimeline {
  /** Timeline length in seconds */
  duration: number;
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

/**
 * Derive export length from composition clips and loaded source media.
 * Clip durations <= 0 mean "use all available media from start".
 * Composition.duration <= 0 means "derive from clips and media only".
 */
export function resolveExportTimeline(
  composition: Composition,
  sourceDuration: number,
): ResolvedExportTimeline {
  const availableFromVideoStart =
    sourceDuration > 0
      ? Math.max(0, sourceDuration - composition.video.start)
      : composition.video.duration;

  const availableFromAudioStart =
    sourceDuration > 0
      ? Math.max(0, sourceDuration - composition.audio.start)
      : composition.audio.duration;

  const videoClipDuration = clipLength(composition.video.duration, availableFromVideoStart);
  const audioClipDuration = clipLength(composition.audio.duration, availableFromAudioStart);

  const videoEnd = composition.video.start + videoClipDuration;
  const imageEnd = composition.image.start + composition.image.duration;
  const audioEnd = composition.audio.start + audioClipDuration;

  const clipEnds = [videoEnd, imageEnd, audioEnd];
  const derivedDuration = Math.max(...clipEnds, 0);
  const duration =
    composition.duration > 0
      ? Math.max(composition.duration, derivedDuration)
      : derivedDuration;

  return {
    duration,
    audioDuration: audioClipDuration,
  };
}
