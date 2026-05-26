import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from 'mediabunny';

interface QueuedVideoPacket {
  kind: 'video';
  packet: EncodedPacket;
  meta?: EncodedVideoChunkMetadata;
}

interface QueuedAudioPacket {
  kind: 'audio';
  packet: EncodedPacket;
  meta?: EncodedAudioChunkMetadata;
}

type QueuedEntry = QueuedVideoPacket | QueuedAudioPacket;

export interface MediaBunnyMuxerOptions {
  fps: number;
  hasAudio: boolean;
}

export class MediaBunnyMuxer {
  private output: Output<Mp4OutputFormat, BufferTarget>;
  private videoSource: EncodedVideoPacketSource;
  private audioSource: EncodedAudioPacketSource | null = null;
  private target = new BufferTarget();
  private queue: QueuedEntry[] = [];
  private nextVideoSequenceNumber = 0;
  private nextAudioSequenceNumber = 0;
  private started = false;

  constructor(options: MediaBunnyMuxerOptions) {
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    this.output = new Output({ format, target: this.target });
    this.videoSource = new EncodedVideoPacketSource('avc');
    this.output.addVideoTrack(this.videoSource, { frameRate: options.fps });
    if (options.hasAudio) {
      this.audioSource = new EncodedAudioPacketSource('aac');
      this.output.addAudioTrack(this.audioSource);
    }
  }

  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    const packet = EncodedPacket.fromEncodedChunk(chunk).clone({
      sequenceNumber: this.nextVideoSequenceNumber++,
    });
    this.queue.push({ kind: 'video', packet, meta });
  }

  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void {
    const packet = EncodedPacket.fromEncodedChunk(chunk).clone({
      sequenceNumber: this.nextAudioSequenceNumber++,
    });
    this.queue.push({ kind: 'audio', packet, meta });
  }

  async finalize(): Promise<ArrayBuffer> {
    if (!this.started) {
      await this.output.start();
      this.started = true;
    }

    for (const entry of this.queue) {
      if (entry.kind === 'video') {
        await this.videoSource.add(entry.packet, entry.meta);
      } else if (this.audioSource) {
        await this.audioSource.add(entry.packet, entry.meta);
      }
    }
    this.queue.length = 0;

    this.videoSource.close();
    this.audioSource?.close();
    await this.output.finalize();

    const buffer = this.target.buffer;
    if (!buffer) {
      throw new Error('MediaBunny muxer produced no buffer');
    }
    return buffer;
  }
}
