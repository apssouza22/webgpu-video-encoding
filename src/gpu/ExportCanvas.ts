export class ExportCanvas {
  private canvas: OffscreenCanvas | null = null;
  private context: GPUCanvasContext | null = null;

  init(device: GPUDevice, width: number, height: number): GPUCanvasContext {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      throw new Error('WebGPU OffscreenCanvas context not available');
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });

    this.context = ctx;
    return ctx;
  }

  getCanvas(): OffscreenCanvas {
    if (!this.canvas) {
      throw new Error('Export canvas not initialized');
    }
    return this.canvas;
  }

  getContext(): GPUCanvasContext {
    if (!this.context) {
      throw new Error('Export canvas context not initialized');
    }
    return this.context;
  }

  async captureVideoFrame(
    device: GPUDevice,
    timestampMicros: number,
    durationMicros: number,
  ): Promise<VideoFrame> {
    await device.queue.onSubmittedWorkDone();
    return new VideoFrame(this.getCanvas(), {
      timestamp: timestampMicros,
      duration: durationMicros,
      alpha: 'discard',
    });
  }

  destroy(): void {
    this.context = null;
    this.canvas = null;
  }
}
