import {
  ALL_FORMATS,
  BlobSource,
  Input,
  VideoSampleSink,
  type VideoSample,
} from 'mediabunny';

export interface DecodedVideoFrame {
  frame: VideoFrame;
  timestamp: number;
  duration: number;
  close: () => void;
}

export class MediaBunnyVideoFrameSource {
  private constructor(
    private readonly input: Input,
    private readonly sink: VideoSampleSink,
    readonly duration: number,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(url: string): Promise<MediaBunnyVideoFrameSource> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch video source: ${url} (${response.status})`);
    }

    const input = new Input({
      source: new BlobSource(await response.blob()),
      formats: ALL_FORMATS,
    });

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error(`No video track found in ${url}`);
      }

      if (!(await videoTrack.canDecode())) {
        const codec = await videoTrack.getCodecParameterString();
        throw new Error(`Browser cannot decode video track${codec ? ` (${codec})` : ''}`);
      }

      return new MediaBunnyVideoFrameSource(
        input,
        new VideoSampleSink(videoTrack),
        await input.computeDuration(),
        videoTrack.displayWidth,
        videoTrack.displayHeight,
      );
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  framesAtTimestamps(timestamps: Iterable<number>): AsyncGenerator<DecodedVideoFrame> {
    return this.decodeFrames(timestamps);
  }

  dispose(): void {
    this.input.dispose();
  }

  private async *decodeFrames(timestamps: Iterable<number>): AsyncGenerator<DecodedVideoFrame> {
    let index = 0;

    for await (const sample of this.sink.samplesAtTimestamps(timestamps)) {
      if (!sample) {
        throw new Error(`MediaBunny returned no video frame for export frame ${index}`);
      }

      yield this.wrapSample(sample);
      index++;
    }
  }

  private wrapSample(sample: VideoSample): DecodedVideoFrame {
    const frame = sample.toVideoFrame();
    let closed = false;

    return {
      frame,
      timestamp: sample.timestamp,
      duration: sample.duration,
      close: () => {
        if (closed) return;
        closed = true;
        frame.close();
        sample.close();
      },
    };
  }
}
