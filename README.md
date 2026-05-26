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
  composition.ts      # Demo timeline (video + image + audio)
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
