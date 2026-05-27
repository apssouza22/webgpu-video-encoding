import compositeShader from '../shaders/composite.wgsl?raw';
import type { ImageClip } from '../types';

const TEXTURE_USAGE =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.RENDER_ATTACHMENT;

export interface CompositorFrameInput {
  time: number;
  videoFrame: VideoFrame;
  overlays: CompositorOverlayInput[];
}

export interface CompositorOverlayInput {
  image: HTMLImageElement;
  imageClip: ImageClip;
}

export class GpuCompositor {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private dummyOverlayTexture: GPUTexture;
  private overlayTextures = new Map<HTMLImageElement, GPUTexture>();

  private constructor(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    uniformBuffer: GPUBuffer,
    bindGroupLayout: GPUBindGroupLayout,
    dummyOverlayTexture: GPUTexture,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.sampler = sampler;
    this.uniformBuffer = uniformBuffer;
    this.bindGroupLayout = bindGroupLayout;
    this.dummyOverlayTexture = dummyOverlayTexture;
  }

  static async create(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
  ): Promise<GpuCompositor> {
    const shaderModule = device.createShaderModule({
      code: compositeShader,
      label: 'composite-shader',
    });

    if (shaderModule.getCompilationInfo) {
      const info = await shaderModule.getCompilationInfo();
      for (const message of info.messages) {
        if (message.type === 'error') {
          throw new Error(`WGSL: ${message.message}`);
        }
      }
    }

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: canvasFormat,
            blend: {
              color: {
                operation: 'add',
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: {
                operation: 'add',
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const dummyOverlayTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE,
    });

    return new GpuCompositor(
      device,
      pipeline,
      sampler,
      uniformBuffer,
      bindGroupLayout,
      dummyOverlayTexture,
    );
  }

  private ensureOverlayTexture(image: HTMLImageElement): GPUTexture | null {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width === 0 || height === 0) {
      return null;
    }

    const existingTexture = this.overlayTextures.get(image);
    if (
      existingTexture &&
      existingTexture.width === width &&
      existingTexture.height === height
    ) {
      return existingTexture;
    }

    existingTexture?.destroy();
    const texture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE,
    });

    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture },
      { width, height },
    );
    this.overlayTextures.set(image, texture);

    return texture;
  }

  async renderFrame(
    canvasContext: GPUCanvasContext,
    input: CompositorFrameInput,
  ): Promise<void> {
    const { videoFrame, overlays } = input;
    const externalVideoTexture = this.device.importExternalTexture({ source: videoFrame });
    const textureView = canvasContext.getCurrentTexture().createView();

    const baseUniforms = new Float32Array([0,0, 0, 0, 0, 0, 0]);
    this.renderPass(
      textureView,
      externalVideoTexture,
      this.dummyOverlayTexture,
      baseUniforms,
      'clear',
    );

    for (const overlay of overlays) {
      const overlayTexture = this.ensureOverlayTexture(overlay.image);
      if (!overlayTexture) {
        continue;
      }

      const { imageClip } = overlay;
      const overlayUniforms = new Float32Array([
        imageClip.opacity,
        imageClip.x,
        imageClip.y,
        imageClip.x + imageClip.width,
        imageClip.y + imageClip.height,
        1,
        1,
      ]);
      this.renderPass(
        textureView,
        externalVideoTexture,
        overlayTexture,
        overlayUniforms,
        'load',
      );
    }
  }

  private renderPass(
    textureView: GPUTextureView,
    externalVideoTexture: GPUExternalTexture,
    overlayTexture: GPUTexture,
    uniformData: Float32Array,
    loadOp: GPULoadOp,
  ): void {
    // @ts-ignore
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: externalVideoTexture },
        { binding: 2, resource: overlayTexture.createView() },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp,
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    for (const texture of this.overlayTextures.values()) {
      texture.destroy();
    }
    this.overlayTextures.clear();
    this.dummyOverlayTexture.destroy();
  }
}
