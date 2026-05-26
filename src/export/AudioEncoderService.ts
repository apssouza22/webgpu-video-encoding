export interface EncodedAudioResult {
  chunks: EncodedAudioChunk[];
  metadata: EncodedAudioChunkMetadata[];
}

export type EncodedAudioChunkCallback = (
  chunk: EncodedAudioChunk,
  metadata?: EncodedAudioChunkMetadata,
) => void;

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

  async encodeBuffer(
    audioBuffer: AudioBuffer,
    onChunk?: EncodedAudioChunkCallback,
  ): Promise<EncodedAudioResult> {
    if (!(await AudioEncoderService.isSupported())) {
      throw new Error('AAC AudioEncoder is not supported in this browser');
    }

    this.chunks = [];
    this.metadata = [];

    this.encoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (onChunk) {
          onChunk(chunk, meta);
        } else {
          this.chunks.push(chunk);
          this.metadata.push(meta ?? {});
        }
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

    const chunkSamples = 1024;
    const channelData = Array.from({ length: this.channels }, (_, channel) =>
      audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1)),
    );
    let timestamp = 0;

    for (let offset = 0; offset < audioBuffer.length; offset += chunkSamples) {
      const frameSamples = Math.min(chunkSamples, audioBuffer.length - offset);
      const frameData = new Float32Array(frameSamples * this.channels);
      for (let channel = 0; channel < this.channels; channel++) {
        const samples = channelData[channel];
        for (let i = 0; i < frameSamples; i++) {
          frameData[i * this.channels + channel] = samples[offset + i] ?? 0;
        }
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: this.sampleRate,
        numberOfFrames: frameSamples,
        numberOfChannels: this.channels,
        timestamp,
        data: frameData,
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
