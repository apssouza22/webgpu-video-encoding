import type { Composition, ExportProgress } from '../types';
import { ExportCanvas } from '../gpu/ExportCanvas';
import { GpuCompositor } from '../gpu/GpuCompositor';
import { VideoEncoderService } from './VideoEncoderService';
import { AudioEncoderService } from './AudioEncoderService';
import { ResolvedExportTimeline, resolveExportTimeline } from './resolveExportTimeline';
import { loadVideo, loadImage, seekVideo } from '../media/MediaLoader';
import { extractAudioFromUrl } from '../media/AudioExtractor';

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

    const video = await loadVideo(composition.video.url);
    const overlay = await loadImage(composition.image.url);

    const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0;
    const timeline = resolveExportTimeline(composition, sourceDuration);
    const exportDuration = timeline.duration;

    const totalFrames = Math.ceil(exportDuration * composition.fps);
    const frameDurationUs = Math.round(1_000_000 / composition.fps);
    const { includeAudio, videoEncoder } = await this.createVideoEncoder(
      onProgress,
      totalFrames,
      composition,
      timeline,
    );

    const exportCanvas = new ExportCanvas();
    const canvasContext = exportCanvas.init(device, composition.width, composition.height);
    const compositor = await GpuCompositor.create(
      device,
      canvasFormat,
      video.videoWidth || composition.width,
      video.videoHeight || composition.height,
    );

    try {
      for (let frame = 0; frame < totalFrames; frame++) {
        await this.renderAndEncodeFrame(
          frame,
          composition,
          frameDurationUs,
          video,
          sourceDuration,
          compositor,
          canvasContext,
          overlay,
          exportCanvas,
          device,
          videoEncoder,
          totalFrames,
          includeAudio,
          onProgress,
        );
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
      compositor.destroy();
      exportCanvas.destroy();
    }
  }

  private async renderAndEncodeFrame(
    frame: number,
    composition: Composition,
    frameDurationUs: number,
    video: HTMLVideoElement,
    sourceDuration: number,
    compositor: GpuCompositor,
    canvasContext: GPUCanvasContext,
    overlay: HTMLImageElement,
    exportCanvas: ExportCanvas,
    device: GPUDevice,
    videoEncoder: VideoEncoderService,
    totalFrames: number,
    includeAudio: boolean,
    onProgress: (progress: ExportProgress) => void,
  ) {
    const time = frame / composition.fps;
    const timestampUs = frame * frameDurationUs;
    const sourceTime = composition.video.start + time;

    await seekVideo(
      video,
      sourceDuration > 0
        ? Math.min(sourceTime, Math.max(0, sourceDuration - 0.001))
        : sourceTime,
    );

    await compositor.renderFrame(canvasContext, {
      time,
      video,
      overlayImage: overlay,
      imageClip: composition.image,
    });

    const videoFrame = await exportCanvas.captureVideoFrame(
      device,
      timestampUs,
      frameDurationUs,
    );

    await videoEncoder.encodeVideoFrame(videoFrame, frame);
    videoFrame.close();

    const percent = ((frame + 1) / totalFrames) * (includeAudio ? 95 : 100);
    onProgress({
      phase: 'video',
      frame: frame + 1,
      totalFrames,
      percent,
      message: `GPU frame ${frame + 1}/${totalFrames}`,
    });
  }

  private async createVideoEncoder(
    onProgress: (progress: ExportProgress) => void,
    totalFrames: number,
    composition: Composition,
    timeline: ResolvedExportTimeline,
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

      audioBuffer = await extractAudioFromUrl(
        composition.audio.url,
        composition.audio.start,
        timeline.audioDuration,
      );

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

    return { includeAudio, videoEncoder };
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
