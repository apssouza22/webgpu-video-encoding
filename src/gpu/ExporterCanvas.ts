export class ExporterCanvas {
  private canvas: OffscreenCanvas | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;

  init(device: GPUDevice, width: number, height: number): GPUCanvasContext {
    this.canvas = new OffscreenCanvas(width, height);
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      throw new Error('WebGPU OffscreenCanvas context not available');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device,
      format: this.format,
      alphaMode: 'premultiplied',
    });

    this.context = ctx;
    return ctx;
  }

  getFormat(): GPUTextureFormat {
    if (!this.format) {
      throw new Error('Export canvas format not initialized');
    }
    return this.format;
  }

  private getCanvas(): OffscreenCanvas {
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
    this.format = null;
  }
}
