import type {AudioClip} from '../types';

export class AudioPlayer {
  private readonly audioContext: AudioContext | null;
  private readonly audioSources = new Map<AudioClip, AudioBufferSourceNode>();
  private isPlaying = false;

  static async create(audioLayers: readonly AudioClip[]): Promise<AudioPlayer> {
    const audioBuffers = await this.loadAudioBuffers(audioLayers);
    return new AudioPlayer(audioLayers, audioBuffers);
  }

  private static async loadAudioBuffers(
    audioLayers: readonly AudioClip[],
  ): Promise<Map<AudioClip, AudioBuffer>> {
    const audioBuffers = new Map<AudioClip, AudioBuffer>();
    const decoded = await Promise.all(
      audioLayers.map(async (clip) => ({
        clip,
        buffer: await clip.getAudioBuffer(),
      })),
    );

    for (const {clip, buffer} of decoded) {
      if (buffer) {
        audioBuffers.set(clip, buffer);
      }
    }

    return audioBuffers;
  }

  private constructor(
    private readonly audioLayers: readonly AudioClip[],
    private readonly audioBuffers: Map<AudioClip, AudioBuffer>,
  ) {
    this.audioContext = audioBuffers.size > 0 ? new AudioContext() : null;
  }

  async play(time: number): Promise<void> {
    this.isPlaying = true;
    await this.resumeAudioContext();
    this.schedulePlayback(time);
  }

  seek(time: number): void {
    if (!this.isPlaying) {
      return;
    }

    this.schedulePlayback(time);
  }

  pause(): void {
    this.isPlaying = false;
    this.stopSources();
  }

  destroy(): void {
    this.pause();
    void this.audioContext?.close();
  }

  private async resumeAudioContext(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'running') {
      return;
    }

    await this.audioContext.resume();
  }

  private schedulePlayback(time: number): void {
    if (!this.audioContext || !this.isPlaying) {
      return;
    }

    this.stopSources();
    const contextStartTime = this.audioContext.currentTime;

    for (const clip of this.audioLayers) {
      const buffer = this.audioBuffers.get(clip);
      if (!buffer) {
        continue;
      }

      const clipDuration = Math.min(clip.duration, buffer.duration);
      const clipEndTime = clip.start + clipDuration;
      if (clipDuration <= 0 || time >= clipEndTime) {
        continue;
      }

      const startsIn = Math.max(clip.start - time, 0);
      const offset = Math.max(time - clip.start, 0);
      const remainingDuration = clipDuration - offset;
      if (remainingDuration <= 0) {
        continue;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.onended = () => {
        if (this.audioSources.get(clip) === source) {
          this.audioSources.delete(clip);
        }
      };

      source.start(contextStartTime + startsIn, offset, remainingDuration);
      this.audioSources.set(clip, source);
    }
  }

  private stopSources(): void {
    for (const source of this.audioSources.values()) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.audioSources.clear();
  }
}
