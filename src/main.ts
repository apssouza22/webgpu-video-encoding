import { DEMO_COMPOSITION } from './composition';
import { GpuVideoExporter, downloadBlob } from './export/GpuVideoExporter';

const statusEl = document.getElementById('status');

function setStatus(message: string): void {
  if (statusEl) {
    statusEl.textContent = message;
  }
  console.log(message);
}

async function verifySamples(): Promise<void> {
  const urls = [
    DEMO_COMPOSITION.video.url,
    DEMO_COMPOSITION.image.url,
  ];

  for (const url of urls) {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(
        `Missing sample media: ${url}\n\n` +
          'Add files under public/samples/:\n' +
          '  - video-2.mp4 (with audio track)\n' +
          '  - overlay.png\n\n' +
          'See README.md for details.',
      );
    }
  }
}

async function main(): Promise<void> {
  setStatus('Checking sample media…');
  await verifySamples();

  setStatus('Starting GPU export (WebCodecs + MediaBunny)…');
  const exporter = new GpuVideoExporter();

  const blob = await exporter.export(DEMO_COMPOSITION, (progress) => {
    setStatus(
      `[${progress.phase}] ${progress.percent.toFixed(1)}% — ${progress.message}`,
    );
  });

  downloadBlob(blob, DEMO_COMPOSITION.outputFilename);
  setStatus(
    `Done. Saved ${DEMO_COMPOSITION.outputFilename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`Export failed:\n${message}`);
  console.error(error);
});
