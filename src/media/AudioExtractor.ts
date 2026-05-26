import {
  Input,
  ALL_FORMATS,
  BlobSource,
  AudioBufferSink,
} from 'mediabunny';

/**
 * Decode audio from a media URL into a single AudioBuffer (Web Audio API).
 * Uses MediaBunny instead of OfflineAudioContext.createMediaElementSource,
 * which is not available on OfflineAudioContext.
 */
export async function extractAudioFromUrl(
  url: string,
  startTime: number,
  duration: number,
): Promise<AudioBuffer | null> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio source: ${url} (${response.status})`);
  }

  const blob = await response.blob();
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });

  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      return null;
    }

    const sampleRate = audioTrack.sampleRate;
    const channels = Math.min(2, Math.max(1, audioTrack.numberOfChannels));
    const endTime = startTime + duration;
    const frameCount = Math.ceil(duration * sampleRate);

    const audioContext = new AudioContext({ sampleRate });
    const merged = audioContext.createBuffer(channels, frameCount, sampleRate);
    const sink = new AudioBufferSink(audioTrack);

    for await (const wrapped of sink.buffers(startTime, endTime)) {
      const offset = Math.round((wrapped.timestamp - startTime) * sampleRate);
      if (offset >= frameCount) {
        continue;
      }

      const source = wrapped.buffer;
      for (let channel = 0; channel < channels; channel++) {
        const srcChannel = source.getChannelData(
          Math.min(channel, source.numberOfChannels - 1),
        );
        const dstChannel = merged.getChannelData(channel);
        const copyLength = Math.min(srcChannel.length, frameCount - offset);
        for (let i = 0; i < copyLength; i++) {
          dstChannel[offset + i] = srcChannel[i];
        }
      }
    }

    return merged;
  } finally {
    input.dispose();
  }
}
