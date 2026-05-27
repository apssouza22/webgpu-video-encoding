import type {Composition} from '../composition';
import type {ExportProgress} from '../types';
import {AudioExport} from './AudioExport';
import {VideoExport} from './VideoExport';

export type ProgressCallback = (progress: ExportProgress) => void;

export class CompositionExporter {

  async export(composition: Composition, onProgress: ProgressCallback): Promise<Blob> {
    let videoExport: VideoExport | null = null;

    try {
      await composition.loadLayerSources();

      const exportDuration = composition.duration;

      const totalFrames = Math.ceil(exportDuration * composition.fps);
      const audioExport = await AudioExport.create({
        audioClips: composition.audioLayers,
        duration: exportDuration,
        totalFrames,
        onProgress,
      });
      const includeAudio = audioExport.hasAudio;
      const videoEncoder = await VideoExport.createEncoder(composition, includeAudio);
      await audioExport.encodeInto(videoEncoder);

      videoExport = await VideoExport.create({
        composition,
        videoEncoder,
        hasAudio: includeAudio,
        onProgress,
      });

      await videoExport.render();

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
      videoExport?.destroy();
      composition.disposeLayerSources();
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
