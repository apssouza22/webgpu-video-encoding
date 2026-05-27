import type {Composition, ExportProgress, VideoClip, VideoFrameContext} from '../types';
import {ExportCanvas} from '../gpu/ExportCanvas';
import {GpuCompositor} from '../gpu/GpuCompositor';
import {FrameRender} from './FrameRender';
import {VideoEncoderService} from './VideoEncoderService';
import {AudioEncoderService} from './AudioEncoderService';
import {extractAudioFromUrl} from '../media/AudioExtractor';

export type ProgressCallback = (progress: ExportProgress) => void;

export class GpuVideoExporter {

  async export(composition: Composition, onProgress: ProgressCallback): Promise<Blob> {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not available');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to acquire GPU adapter');
    }

    const device = await adapter.requestDevice();
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    const exportCanvas = new ExportCanvas();
    let compositor: GpuCompositor | null = null;

    try {
      await composition.loadLayerSources();

      const exportDuration = composition.duration;

      const totalFrames = Math.ceil(exportDuration * composition.fps);
      const frameDurationUs = Math.round(1_000_000 / composition.fps);
      const {includeAudio, videoEncoder} = await this.createVideoEncoder(
          onProgress,
          totalFrames,
          composition,
      );

      const canvasContext = exportCanvas.init(device, composition.width, composition.height);
      compositor = await GpuCompositor.create(
          device,
          canvasFormat,
      );

      const framesList = composition.getAllFrames()
      await this.bindVideoFrameStreams(framesList);

      const frameRender = new FrameRender({
        frameDurationUs,
        compositor,
        canvasContext,
        exportCanvas,
        device,
        videoEncoder,
        totalFrames,
        includeAudio,
        onProgress,
      });

      for (const frame of framesList) {
        await frameRender.renderAndEncode(frame);
      }

      onProgress({
        phase: 'mux',
        frame: totalFrames,
        totalFrames,
        percent: 98,
        message: 'Muxing MP4 with MediaBunny…',
      });

      const blob = await videoEncoder.finish();

      onProgress({
        phase: 'mux',
        frame: totalFrames,
        totalFrames,
        percent: 100,
        message: 'Export complete',
      });

      return blob;
    } finally {
      compositor?.destroy();
      exportCanvas.destroy();
      composition.disposeLayerSources();
    }
  }

  private async createVideoEncoder(
      onProgress: (progress: ExportProgress) => void,
      totalFrames: number,
      composition: Composition,
  ) {
    const audioSupported = await AudioEncoderService.isSupported();
    let includeAudio = false;
    let audioBuffer: AudioBuffer | null = null;

    if (audioSupported) {
      onProgress({
        phase: 'audio',
        frame: 0,
        totalFrames,
        percent: 0,
        message: 'Decoding audio from video clip (MediaBunny)…',
      });

      const videoClip = composition.video;
      audioBuffer = videoClip
          ? await extractAudioFromUrl(videoClip.url, 0, videoClip.duration)
          : null;

      if (audioBuffer) {
        includeAudio = true;
      } else {
        console.warn('No audio track found — exporting video only');
      }
    }

    const videoEncoder = new VideoEncoderService({
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      bitrate: 8_000_000,
      hasAudio: includeAudio,
    });
    await videoEncoder.init();

    if (audioBuffer) {
      const audioEncoder = new AudioEncoderService(audioBuffer.sampleRate, 2, 192_000);
      await audioEncoder.encodeBuffer(audioBuffer, (chunk, metadata) => {
        videoEncoder.addAudioChunk(chunk, metadata);
      });
    }

    return {includeAudio, videoEncoder};
  }

  private async bindVideoFrameStreams(videoFrames: VideoFrameContext[]): Promise<void> {
    const clips = this.getVideoClips(videoFrames);
    await Promise.all(
        Array.from(clips, (clip) => clip.bindFrameStream(videoFrames)),
    );
  }

  private getVideoClips(videoFrames: VideoFrameContext[]) {
    const clips = new Set<VideoClip>();

    for (const context of videoFrames) {
      for (const videoLayer of context.videos) {
        clips.add(videoLayer.clip);
      }
    }

    return clips;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
