import type { Composition, ExportProgress, ImageClip, RenderFrameContext, VideoClip } from '../types';
import { ExportCanvas } from '../gpu/ExportCanvas';
import { GpuCompositor } from '../gpu/GpuCompositor';
import { FrameRender } from './FrameRender';
import { VideoEncoderService } from './VideoEncoderService';
import { AudioEncoderService } from './AudioEncoderService';
import { ResolvedExportTimeline, resolveExportTimeline } from './resolveExportTimeline';
import { loadImage } from '../media/MediaLoader';
import { extractAudioFromUrl } from '../media/AudioExtractor';
import { buildRenderFrameContext } from '../composition';
import type { DecodedVideoFrame } from '../media/VideoFrameSource';

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

    if (!composition.video) {
      throw new Error('Composition must include at least one video layer');
    }

    const exportCanvas = new ExportCanvas();
    let compositor: GpuCompositor | null = null;

    try {
      await composition.openLayerSources();
      const overlayImages = await this.loadOverlayImages(composition.imageLayers);

      const timeline = resolveExportTimeline(composition);
      const exportDuration = timeline.duration;

      const totalFrames = Math.ceil(exportDuration * composition.fps);
      const frameDurationUs = Math.round(1_000_000 / composition.fps);
      const { includeAudio, videoEncoder } = await this.createVideoEncoder(
        onProgress,
        totalFrames,
        composition,
        timeline,
      );

      const canvasContext = exportCanvas.init(device, composition.width, composition.height);
      compositor = await GpuCompositor.create(
        device,
        canvasFormat,
      );

      const frameContexts = this.buildRenderFrameContexts(
        composition,
        timeline,
        totalFrames,
        frameDurationUs,
      );
      await this.bindVideoFrameStreams(frameContexts);

      const frameRender = new FrameRender({
        frameDurationUs,
        compositor,
        canvasContext,
        overlayImages,
        exportCanvas,
        device,
        videoEncoder,
        totalFrames,
        includeAudio,
        onProgress,
      });

      for (const renderFrame of frameContexts) {
        await frameRender.renderAndEncode(renderFrame);
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

      const videoClip = composition.video;
      audioBuffer = videoClip
        ? await extractAudioFromUrl(videoClip.url, 0, timeline.audioDuration)
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

    return { includeAudio, videoEncoder };
  }

  private async loadOverlayImages(imageClips: ImageClip[]): Promise<Map<ImageClip, HTMLImageElement>> {
    const overlayImages = new Map<ImageClip, HTMLImageElement>();
    await Promise.all(
      imageClips.map(async (clip) => {
        overlayImages.set(clip, await loadImage(clip.url));
      }),
    );

    return overlayImages;
  }

  private buildRenderFrameContexts(
    composition: Composition,
    timeline: ResolvedExportTimeline,
    totalFrames: number,
    frameDurationUs: number,
  ): RenderFrameContext[] {
    return Array.from({ length: totalFrames }, (_, frame) =>
      buildRenderFrameContext(composition, frame, frameDurationUs, timeline.clipDurations),
    );
  }

  private async bindVideoFrameStreams(frameContexts: RenderFrameContext[]): Promise<void> {
    const timestampsByClip = new Map<VideoClip, number[]>();

    for (const context of frameContexts) {
      for (const videoLayer of context.videos) {
        const timestamps = timestampsByClip.get(videoLayer.clip) ?? [];
        timestamps.push(videoLayer.sourceTime);
        timestampsByClip.set(videoLayer.clip, timestamps);
      }
    }

    const streamsByClip = new Map<VideoClip, AsyncGenerator<DecodedVideoFrame>>();
    for (const [clip, timestamps] of timestampsByClip) {
      streamsByClip.set(clip, await clip.framesAtTimestamps(timestamps));
    }

    for (const context of frameContexts) {
      for (const videoLayer of context.videos) {
        const stream = streamsByClip.get(videoLayer.clip);
        if (!stream) {
          continue;
        }

        videoLayer.nextSourceFrame = async () => {
          const result = await stream.next();
          if (result.done) {
            throw new Error(`MediaBunny video stream ended before export frame ${context.frame}`);
          }

          return result.value;
        };
      }
    }
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
