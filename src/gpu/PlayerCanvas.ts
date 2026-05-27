export class PlayerCanvas {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;

  init(device: GPUDevice, width: number, height: number): GPUCanvasContext {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) {
      throw new Error('WebGPU canvas context not available');
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
      throw new Error('Player canvas format not initialized');
    }
    return this.format;
  }

  getCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      throw new Error('Player canvas not initialized');
    }
    return this.canvas;
  }

  getContext(): GPUCanvasContext {
    if (!this.context) {
      throw new Error('Player canvas context not initialized');
    }
    return this.context;
  }

  destroy(): void {
    this.context = null;
    this.canvas = null;
    this.format = null;
  }
}
