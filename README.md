# gpu-video-export

Minimal browser demo of **GPU compositing → OffscreenCanvas → WebCodecs → MediaBunny MP4**, inspired by MasterSelects export architecture but stripped down.

## What it does

On page load (Chrome/Edge recommended):

1. Loads a simple composition: **video** base layer, **image** overlay (from 2s), **audio** from the video clip
2. Renders each frame on a **WebGPU OffscreenCanvas** (no `readPixels` CPU fallback)
3. Captures **`VideoFrame`** from the canvas (zero-copy path)
4. Encodes with **`VideoEncoder`** (H.264 / WebCodecs)
5. Muxes to **MP4** with **MediaBunny**
6. Automatically downloads `composition-export.mp4`

## Composition API

Compositions are built from ordered clip layers. A frame context exposes the
active clips at a timeline time, and active video clips can decode their next
source frame from that context.

```ts
import { Composition, ImageClip, VideoClip } from './src/composition';

const composition = new Composition(30, 1280, 720);

composition
  .addLayer(new VideoClip('/samples/video.mp4', 0, 0, 0, 0, 1, 1))
  .addLayer(new ImageClip('/samples/overlay.png', 2, 3, 0.62, 0.08, 0.32, 0.32, 0.92));

const frame = composition.getFrameContextAtTime(2.5);
const sourceFrame = await frame.video?.nextSourceFrame();
```

## Requirements

- Browser with **WebGPU**, **WebCodecs** (`VideoEncoder`, `AudioEncoder`), and `VideoFrame(OffscreenCanvas)`
- **Chrome or Edge (desktop)** recommended — Safari/Firefox often lack H.264 `VideoEncoder` support; the app probes several `avc1.*` profiles automatically
- Sample media in `public/samples/`:
  - `video.mp4` — clip **with an audio track** (export length follows the file; overlay timing is set in `composition.ts`)
  - `overlay.png` — PNG with transparency for the overlay

## Quick start

```bash
cd gpu-video-export
npm install
# copy your files:
#   public/samples/video-2.mp4
#   public/samples/overlay.png
npm run dev
```

Open http://localhost:5180 — export runs automatically and triggers a download.

## Project layout

```
src/
  composition.ts      # Public composition API and demo timeline
  export/
    GpuVideoExporter.ts   # Orchestrator
    VideoEncoderService.ts
    AudioEncoderService.ts
    MediaBunnyMuxer.ts
  gpu/
    ExportCanvas.ts     # OffscreenCanvas + VideoFrame capture
    GpuCompositor.ts    # WebGPU composite (video + image)
  media/
    MediaLoader.ts      # Load/seek video, offline audio render
  shaders/
    composite.wgsl
```

## Differences from MasterSelects

| MasterSelects | This project |
|---------------|--------------|
| Full timeline / effects | Fixed demo composition |
| Fast WebCodecs decode + precise fallback | HTMLVideo seek per frame |
| `readPixels` fallback | GPU-only capture |
| Multiple containers/codecs | MP4 + H.264 + AAC only |

## License

MIT (demo code)
