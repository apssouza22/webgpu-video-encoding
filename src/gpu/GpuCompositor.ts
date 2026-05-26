import compositeShader from '../shaders/composite.wgsl?raw';
import type { ImageClip } from '../types';

const TEXTURE_USAGE =
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_DST |
  GPUTextureUsage.RENDER_ATTACHMENT;

export interface CompositorFrameInput {
  time: number;
  video: HTMLVideoElement;
  overlayImage: HTMLImageElement | null;
  imageClip: ImageClip;
}

export class GpuCompositor {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private overlayTexture: GPUTexture;
  private dummyOverlayTexture: GPUTexture;
  private videoTexture: GPUTexture;

  private constructor(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    sampler: GPUSampler,
    uniformBuffer: GPUBuffer,
    bindGroupLayout: GPUBindGroupLayout,
    overlayTexture: GPUTexture,
    dummyOverlayTexture: GPUTexture,
    videoTexture: GPUTexture,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.sampler = sampler;
    this.uniformBuffer = uniformBuffer;
    this.bindGroupLayout = bindGroupLayout;
    this.overlayTexture = overlayTexture;
    this.dummyOverlayTexture = dummyOverlayTexture;
    this.videoTexture = videoTexture;
  }

  static async create(
    device: GPUDevice,
    canvasFormat: GPUTextureFormat,
    videoWidth: number,
    videoHeight: number,
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
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
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
        targets: [{ format: canvasFormat }],
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

    const overlayTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE,
    });

    const dummyOverlayTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE,
    });

    const videoTexture = device.createTexture({
      size: {
        width: Math.max(1, videoWidth),
        height: Math.max(1, videoHeight),
      },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE,
    });

    return new GpuCompositor(
      device,
      pipeline,
      sampler,
      uniformBuffer,
      bindGroupLayout,
      overlayTexture,
      dummyOverlayTexture,
      videoTexture,
    );
  }

  private ensureVideoTexture(video: HTMLVideoElement): void {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      return;
    }

    if (this.videoTexture.width !== width || this.videoTexture.height !== height) {
      this.videoTexture.destroy();
      this.videoTexture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: TEXTURE_USAGE,
      });
    }
  }

  private ensureOverlayTexture(image: HTMLImageElement): void {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width === 0 || height === 0) {
      return;
    }

    if (this.overlayTexture.width !== width || this.overlayTexture.height !== height) {
      this.overlayTexture.destroy();
      this.overlayTexture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: TEXTURE_USAGE,
      });
    }
  }

  async renderFrame(
    canvasContext: GPUCanvasContext,
    input: CompositorFrameInput,
  ): Promise<void> {
    const { time, video, overlayImage, imageClip } = input;
    const showOverlay =
      overlayImage !== null &&
      time >= imageClip.start &&
      time < imageClip.start + imageClip.duration;

    this.ensureVideoTexture(video);
    if (showOverlay && overlayImage) {
      this.ensureOverlayTexture(overlayImage);
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.videoTexture.createView() },
        {
          binding: 2,
          resource: (showOverlay ? this.overlayTexture : this.dummyOverlayTexture).createView(),
        },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });

    const uniformData = new Float32Array([
      showOverlay ? imageClip.opacity : 0,
      imageClip.x,
      imageClip.y,
      imageClip.x + imageClip.width,
      imageClip.y + imageClip.height,
      showOverlay ? 1 : 0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const videoWidth = video.videoWidth || 1;
    const videoHeight = video.videoHeight || 1;

    if (videoWidth > 0 && videoHeight > 0) {
      this.device.queue.copyExternalImageToTexture(
        { source: video },
        { texture: this.videoTexture },
        { width: videoWidth, height: videoHeight },
      );
    }

    if (showOverlay && overlayImage) {
      const ow = overlayImage.naturalWidth || overlayImage.width;
      const oh = overlayImage.naturalHeight || overlayImage.height;
      if (ow > 0 && oh > 0) {
        this.device.queue.copyExternalImageToTexture(
          { source: overlayImage },
          { texture: this.overlayTexture },
          { width: ow, height: oh },
        );
      }
    }

    const encoder = this.device.createCommandEncoder();
    const textureView = canvasContext.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();
  }

  destroy(): void {
    this.overlayTexture.destroy();
    this.dummyOverlayTexture.destroy();
    this.videoTexture.destroy();
  }
}
