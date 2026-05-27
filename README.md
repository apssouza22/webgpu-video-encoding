# gpu-video-export

Minimal browser demo of **GPU preview/playback + GPU export → OffscreenCanvas → WebCodecs → MediaBunny MP4**.

## What it does

In a supported desktop browser (Chrome/Edge recommended), the app:

1. Loads a timeline-style composition with ordered **video**, **image**, and **audio** layers
2. Shows an interactive WebGPU preview player with play/pause controls, audio playback, and a scrubber
3. Renders export frames on a **WebGPU OffscreenCanvas** (no `readPixels` CPU fallback)
4. Captures each rendered frame as a **`VideoFrame`** from the canvas
5. Encodes video with **`VideoEncoder`** (H.264 / WebCodecs)
6. Encodes audio with **`AudioEncoder`** (AAC / WebCodecs) when supported
7. Muxes everything to **MP4** with **MediaBunny**
8. Downloads `composition-export.mp4` when export finishes

The demo composition is 1280x720 at 30 fps. It plays `video.mp4` for the first 5 seconds, switches to `video-2.mp4`, schedules explicit audio layers from the same files for preview playback, and displays two transparent image overlays from 1s to 4s. Export currently encodes the first audio layer when browser AAC support is available.

## Composition API

Compositions are built from ordered clip layers. A frame context exposes the
active clips at a timeline time, and active video clips can decode their next
source frame from that context.

```ts
import { AudioClip, Composition, ImageClip, VideoClip } from './src/composition';

const composition = new Composition(30, 1280, 720, {
  outputFilename: 'composition-export.mp4',
});

composition
  .addLayer(new VideoClip('/samples/video.mp4', 0, 5))
  .addLayer(new VideoClip('/samples/video-2.mp4', 5))
  .addLayer(new AudioClip('/samples/video.mp4', 0, 5))
  .addLayer(new AudioClip('/samples/video-2.mp4', 5))
  .addLayer(new ImageClip('/samples/overlay.png', 1, 3, 0.62, 0.08, 0.32, 0.32, 0.92));

const frame = composition.getFrameContextAtTime(2.5);
const sourceFrame = await frame.videos[0]?.nextSourceFrame();
```

## Requirements

- Browser with **WebGPU**, **WebCodecs** (`VideoEncoder`, `AudioEncoder`), and `VideoFrame(OffscreenCanvas)`
- **Chrome or Edge (desktop)** recommended — Safari/Firefox often lack H.264 `VideoEncoder` support; the app probes several `avc1.*` profiles automatically
- Sample media in `public/samples/`:
  - `video.mp4` — first video clip, ideally with an audio track
  - `video-2.mp4` — second video clip, ideally with an audio track
  - `overlay.png` — transparent PNG shown on the right side from 1s to 4s
  - `overlay-2.png` — transparent PNG shown on the left side from 1s to 4s
- MediaBunny dependency is currently resolved from `../MasterSelects/node_modules/mediabunny`; adjust `package.json` if you want to install it from npm or another local path

## Quick start

```bash
cd gpu-video-export
npm install
# copy your files:
#   public/samples/video.mp4
#   public/samples/video-2.mp4
#   public/samples/overlay.png
#   public/samples/overlay-2.png
npm run dev
```

Open http://localhost:5180. The app checks sample media, loads the preview player, then enables **Export composition**. Press the button to render and download the MP4.

## Project layout

```
src/
  composition.ts          # Public composition API and demo timeline
  main.ts                 # Sample checks, preview boot, export button wiring
  types.ts                # Clip types and frame/export contracts
  export/
    CompositionExporter.ts # Export orchestrator
    FrameRender.ts        # Render one timeline frame and encode it
    VideoEncoderService.ts
    AudioEncoderService.ts
    MediaBunnyMuxer.ts
  gpu/
    PlayerCanvas.ts       # On-page WebGPU preview canvas
    ExporterCanvas.ts     # OffscreenCanvas + VideoFrame capture
    GpuCompositor.ts      # WebGPU composite (video + image overlays)
  media/
    MediaLoader.ts        # Image loading helpers
    VideoFrameSource.ts   # MediaBunny video decode helpers
  player/
    CompositionPlayer.ts  # Preview UI and playback loop
    VideoPlayer.ts        # WebGPU video preview renderer
    AudioPlayer.ts        # Audio preview scheduling
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
