/** H.264 codec strings to try, most compatible first (matches MasterSelects preference). */
const H264_CODEC_CANDIDATES = [
  'avc1.4d0028', // Main Profile, Level 4.0
  'avc1.640028', // High Profile, Level 4.0
  'avc1.640033', // High Profile, Level 5.1 (1080p-class)
  'avc1.42E01E', // Baseline, Level 3.1
  'avc1.42001E', // Baseline, Level 3.0
] as const;

const HARDWARE_PREFERENCES: Array<VideoEncoderConfig['hardwareAcceleration'] | undefined> = [
  undefined,
  'prefer-hardware',
  'prefer-software',
  'no-preference',
];

export interface ResolvedVideoEncoderConfig {
  config: VideoEncoderConfig;
  codec: string;
}

export async function resolveVideoEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<ResolvedVideoEncoderConfig> {
  const base: Omit<VideoEncoderConfig, 'codec' | 'hardwareAcceleration'> = {
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
    bitrateMode: 'variable',
  };

  const errors: string[] = [];

  for (const hardwareAcceleration of HARDWARE_PREFERENCES) {
    for (const codec of H264_CODEC_CANDIDATES) {
      const candidate: VideoEncoderConfig = {
        ...base,
        codec,
        ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
      };

      try {
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported) {
          const config = support.config ?? candidate;
          return { config, codec: config.codec ?? codec };
        }
        errors.push(`${codec}${hardwareAcceleration ? ` (${hardwareAcceleration})` : ''}: unsupported`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${codec}: ${message}`);
      }
    }
  }

  throw new Error(
    'No supported H.264 VideoEncoder configuration found.\n' +
      `Tried: ${H264_CODEC_CANDIDATES.join(', ')}\n` +
      `Details:\n${errors.slice(0, 6).join('\n')}\n` +
      'Use Chrome or Edge on desktop for WebCodecs H.264 export.',
  );
}
