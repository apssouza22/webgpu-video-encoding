import {CompositionExporter, downloadBlob} from './export/CompositionExporter';
import {CompositionPlayer} from './player/CompositionPlayer';
import {DEMO_COMPOSITION} from "./composition";

const statusEl = document.getElementById('status');
const playerEl = document.getElementById('player');
const exportButton = document.getElementById('export-button') as HTMLButtonElement | null;
let player: CompositionPlayer | null = null;

function setStatus(message: string): void {
  if (statusEl) {
    statusEl.textContent = message;
  }
  console.log(message);
}

async function verifySamples(): Promise<void> {
  const urls = DEMO_COMPOSITION.layers.map((clip) => clip.url);

  for (const url of urls) {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(
        `Missing sample media: ${url}\n\n` +
          'Add files under public/samples/:\n' +
          '  - video.mp4 (with audio track)\n' +
          '  - overlay.png\n\n' +
          'See README.md for details.',
      );
    }
  }
}

async function main(): Promise<void> {
  setStatus('Checking sample media…');
  await verifySamples();

  if (!playerEl || !exportButton) {
    throw new Error('Missing player or export button markup');
  }

  setStatus('Loading preview…');
  await DEMO_COMPOSITION.loadLayerSources();
  player = await CompositionPlayer.create(DEMO_COMPOSITION, playerEl);
  setStatus('Preview ready. Press Export composition to render an MP4.');

  exportButton.disabled = false;
  exportButton.addEventListener('click', exportComposition);
}

async function exportComposition(): Promise<void> {
  if (!exportButton) {
    return;
  }

  exportButton.disabled = true;
  player?.pause();
  setStatus('Starting GPU export (WebCodecs + MediaBunny)…');

  const exporter = new CompositionExporter();

  try {
    const blob = await exporter.export(DEMO_COMPOSITION, (progress) => {
      setStatus(
        `[${progress.phase}] ${progress.percent.toFixed(1)}% — ${progress.message}`,
      );
    });

    downloadBlob(blob, DEMO_COMPOSITION.outputFilename);
    setStatus(
      `Done. Saved ${DEMO_COMPOSITION.outputFilename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Export failed:\n${message}`);
    console.error(error);
  } finally {
    exportButton.disabled = false;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Initialization failed:\n${message}`);
  console.error(error);
});
