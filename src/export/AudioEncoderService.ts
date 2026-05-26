export interface EncodedAudioResult {
  chunks: EncodedAudioChunk[];
  metadata: EncodedAudioChunkMetadata[];
}

export class AudioEncoderService {
  private chunks: EncodedAudioChunk[] = [];
  private metadata: EncodedAudioChunkMetadata[] = [];
  private encoder: AudioEncoder | null = null;
  private sampleRate: number;
  private channels: number;
  private bitrate: number;

  constructor(sampleRate = 48000, channels = 2, bitrate = 192_000) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bitrate = bitrate;
  }

  static async isSupported(): Promise<boolean> {
    if (!('AudioEncoder' in window)) {
      return false;
    }
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 192_000,
    });
    return support.supported === true;
  }

  async encodeBuffer(audioBuffer: AudioBuffer): Promise<EncodedAudioResult> {
    if (!(await AudioEncoderService.isSupported())) {
      throw new Error('AAC AudioEncoder is not supported in this browser');
    }

    this.chunks = [];
    this.metadata = [];

    this.encoder = new AudioEncoder({
      output: (chunk, meta) => {
        this.chunks.push(chunk);
        this.metadata.push(meta ?? {});
      },
      error: (error) => {
        throw error;
      },
    });

    this.encoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: this.sampleRate,
      numberOfChannels: this.channels,
      bitrate: this.bitrate,
    });

    const interleaved = interleaveAudioBuffer(audioBuffer, this.channels);
    const chunkSamples = 1024;
    let timestamp = 0;

    for (let offset = 0; offset < interleaved.length; offset += chunkSamples * this.channels) {
      const frameSamples = Math.min(chunkSamples, (interleaved.length - offset) / this.channels);
      const frameData = interleaved.subarray(offset, offset + frameSamples * this.channels);

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: this.sampleRate,
        numberOfFrames: frameSamples,
        numberOfChannels: this.channels,
        timestamp,
        data: new Float32Array(frameData),
      });

      this.encoder.encode(audioData);
      audioData.close();
      timestamp += Math.round((frameSamples / this.sampleRate) * 1_000_000);
    }

    await this.encoder.flush();
    this.encoder.close();
    this.encoder = null;

    return { chunks: this.chunks, metadata: this.metadata };
  }
}

function interleaveAudioBuffer(buffer: AudioBuffer, channels: number): Float32Array {
  const length = buffer.length;
  const interleaved = new Float32Array(length * channels);
  for (let channel = 0; channel < channels; channel++) {
    const channelData = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
    for (let i = 0; i < length; i++) {
      interleaved[i * channels + channel] = channelData[i] ?? 0;
    }
  }
  return interleaved;
}
