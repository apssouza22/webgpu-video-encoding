struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0),
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

struct LayerUniforms {
  opacity: f32,
  rectMinX: f32,
  rectMinY: f32,
  rectMaxX: f32,
  rectMaxY: f32,
  hasOverlay: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var overlayTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> layer: LayerUniforms;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var color = textureSample(baseTexture, texSampler, input.uv);

  // textureSample must run in uniform control flow — always sample, mask in math.
  let rectSize = vec2f(layer.rectMaxX - layer.rectMinX, layer.rectMaxY - layer.rectMinY);
  let overlayUv = select(
    vec2f(0.5),
    (input.uv - vec2f(layer.rectMinX, layer.rectMinY)) / rectSize,
    rectSize.x > 0.0001 && rectSize.y > 0.0001,
  );
  let overlay = textureSample(overlayTexture, texSampler, clamp(overlayUv, vec2f(0.0), vec2f(1.0)));

  let inRectX = step(layer.rectMinX, input.uv.x) * step(input.uv.x, layer.rectMaxX);
  let inRectY = step(layer.rectMinY, input.uv.y) * step(input.uv.y, layer.rectMaxY);
  let inRect = inRectX * inRectY;
  let overlayWeight = layer.hasOverlay * inRect * overlay.a * layer.opacity;

  return mix(color, overlay, overlayWeight);
}
