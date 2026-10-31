/**
 * Lit Earth for Orbit World, drawn with Three.js. Framework-free and
 * imperative: create once per canvas, call `render` with the frame's camera
 * matrices (from orbit-world-model) and light. No clock, no animation loop.
 *
 * Layers: deterministic star field, day/night surface with a soft
 * sun-driven terminator, warm twilight band, ocean specular from a water
 * mask, cloud shadows and a lit cloud shell, and an atmosphere shell whose
 * glow is integrated analytically from the ray's closest approach (thin
 * Rayleigh-like rim, forward-scattering crescent when backlit, sunset tint
 * at the terminator). It is an art-directed approximation, not a physical
 * scattering simulation.
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, LinearMipmapLinearFilter,
  LinearFilter, Mesh, NoColorSpace, PerspectiveCamera, Points, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace,
  Scene, ShaderMaterial, Texture, Vector3, WebGLRenderer,
} from "three";
import { geoToVec, starField } from "./orbit-world-model";
import type { Vec3 } from "./orbit-world-model";

export interface GlobeTextureImages {
  day: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  night?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  water?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  clouds?: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
}
export interface GlobeLook {
  atmosphereColor: string; atmosphereStrength: number; space: string;
  clouds: boolean; stars: boolean; nightLights: boolean;
  /** Overall exposure before ACES tone mapping. */
  exposure?: number;
}
export interface GlobeFrame {
  view: Float32Array; projection: Float32Array; sun: Vec3;
  /** Cloud drift as a fraction of a full turn (a pure function of the frame). */
  cloudShift: number;
  /** 0..1 star brightness, so a bright planet can hold the exposure. */
  starGain: number;
}

/** Equirectangular sphere with a duplicated seam column, so texture filtering wraps cleanly at the dateline. */
function sphere(radius: number, lonSegments: number, latSegments: number): BufferGeometry {
  const count = (lonSegments + 1) * (latSegments + 1);
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  for (let j = 0; j <= latSegments; j++) for (let i = 0; i <= lonSegments; i++) {
    const k = j * (lonSegments + 1) + i, u = i / lonSegments, v = j / latSegments;
    const p = geoToVec(-90 + v * 180, -180 + u * 360);
    pos.set([p[0] * radius, p[1] * radius, p[2] * radius], k * 3); uv.set([u, v], k * 2);
  }
  const index: number[] = [];
  for (let j = 0; j < latSegments; j++) for (let i = 0; i < lonSegments; i++) {
    const a = j * (lonSegments + 1) + i, b = a + 1, c = a + lonSegments + 1, d = c + 1;
    index.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

const SURFACE_VERT = `
varying vec3 vPos; varying vec2 vUv;
void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const EARTH_FRAG = `
uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform sampler2D cloudMap;
uniform float hasNight; uniform float hasWater; uniform float hasClouds; uniform float nightLights;
uniform vec3 sunDir; uniform vec3 atmoColor; uniform float atmoStrength; uniform float cloudShift; uniform float exposure;
varying vec3 vPos; varying vec2 vUv;
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
void main(){
  vec3 N = normalize(vPos); vec3 V = normalize(cameraPosition - vPos); vec3 L = normalize(sunDir);
  float ndl = dot(N, L); float ndv = max(dot(N, V), 0.0);
  vec3 albedo = texture2D(dayMap, vUv).rgb;
  float day = smoothstep(-0.06, 0.2, ndl);
  // Lambert with a slight wrap: the terminator softens over a few degrees, like real twilight.
  float lit = clamp((ndl + 0.06) / 1.06, 0.0, 1.0);
  vec3 col = albedo * lit * exposure;
  float tw = smoothstep(-0.12, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.32, ndl));
  col *= mix(vec3(1.0), vec3(1.08, 0.66, 0.42), tw * 0.6);
  float clouds = 0.0;
  if (hasClouds > 0.5) {
    clouds = smoothstep(0.18, 0.9, texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r);
    // Shadow cast down-sun by the cloud shell.
    float shade = smoothstep(0.18, 0.9, texture2D(cloudMap, vec2(vUv.x + cloudShift - L.x * 0.0012, vUv.y - L.y * 0.0012)).r);
    col *= 1.0 - 0.32 * shade * day;
  }
  if (hasWater > 0.5) {
    float water = texture2D(waterMap, vUv).r;
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    float spec = pow(nh, 340.0) * 0.6 + pow(nh, 60.0) * 0.015;
    col += water * (1.0 - clouds) * spec * (0.55 + fres) * vec3(1.0, 0.92, 0.8) * smoothstep(0.0, 0.18, ndl) * exposure * 0.55;
    // Open ocean reads a touch deeper and bluer than the raw composite.
    col = mix(col, col * vec3(0.62, 0.74, 0.92), water * 0.6);
  }
  if (hasNight > 0.5) {
    vec3 n = texture2D(nightMap, vUv).rgb;
    float nightSide = 1.0 - smoothstep(-0.16, 0.04, ndl);
    vec3 lights = n * smoothstep(0.02, 0.22, luma(n));
    col += (lights * vec3(1.15, 0.92, 0.7) * nightLights * 2.4 * (1.0 - 0.75 * clouds) + n * 0.05) * nightSide;
    col += albedo * 0.012 * nightSide;
  }
  // Aerial perspective: the lit limb takes the atmosphere's colour.
  float rim = pow(1.0 - ndv, 2.6);
  float sunlit = 0.06 + 0.94 * smoothstep(-0.28, 0.35, ndl);
  col = col * (1.0 - rim * 0.35 * min(atmoStrength, 1.5) * sunlit) + atmoColor * (rim * 0.75 + 0.012) * sunlit * atmoStrength;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;
const CLOUD_FRAG = `
uniform sampler2D cloudMap; uniform vec3 sunDir; uniform vec3 atmoColor; uniform float cloudShift; uniform float exposure;
varying vec3 vPos; varying vec2 vUv;
void main(){
  vec3 N = normalize(vPos); vec3 L = normalize(sunDir); vec3 V = normalize(cameraPosition - vPos);
  float c = smoothstep(0.16, 0.92, texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).r);
  float ndl = dot(N, L);
  float lit = clamp((ndl + 0.1) / 1.1, 0.0, 1.0);
  float tw = smoothstep(-0.14, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.3, ndl));
  vec3 col = vec3(0.96, 0.97, 1.0) * lit * exposure * 1.05 * mix(vec3(1.0), vec3(1.1, 0.68, 0.48), tw * 0.7);
  // Clouds thin towards the limb, where they sit in the atmosphere's haze.
  float edge = smoothstep(0.0, 0.35, max(dot(N, V), 0.0));
  gl_FragColor = vec4(col + atmoColor * 0.02, c * (0.55 + 0.45 * edge) * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;
const ATMO_VERT = `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const ATMO_FRAG = `
uniform vec3 sunDir; uniform vec3 atmoColor; uniform vec3 sunsetColor; uniform float atmoStrength; uniform float shell;
varying vec3 vPos;
void main(){
  vec3 D = normalize(vPos - cameraPosition);
  float b = dot(cameraPosition, D);
  vec3 P = cameraPosition - D * b;
  float h = length(P);
  if (h < 1.0) discard;
  float alt = h - 1.0;
  // Thin bright rim plus a wide faint halo, both falling off with height.
  float thin = exp(-alt / 0.0095) * 0.9;
  float dens = thin + exp(-alt / 0.028) * 0.12;
  dens *= 1.0 - smoothstep(shell - 1.0 - 0.04, shell - 1.0, alt);
  vec3 L = normalize(sunDir);
  float mu = dot(normalize(P), L);
  float sunlit = 0.07 + 0.93 * smoothstep(-0.3, 0.3, mu);
  float sunset = smoothstep(-0.4, -0.04, mu) * (1.0 - smoothstep(-0.04, 0.32, mu));
  float forward = pow(max(dot(D, L), 0.0), 8.0) * smoothstep(-0.45, 0.0, mu);
  vec3 col = (mix(atmoColor, sunsetColor, sunset * 0.75) * dens * sunlit + mix(sunsetColor, vec3(1.0, 0.86, 0.66), 0.5) * (thin + exp(-alt / 0.016) * 0.1) * forward * 1.5) * atmoStrength;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
}`;
const STAR_VERT = `
attribute float size; attribute vec3 tint; uniform float gain; varying vec3 vTint;
void main(){ vTint = tint * gain; gl_PointSize = size; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const STAR_FRAG = `
varying vec3 vTint;
void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vTint * a, 1.0); }`;

export class OrbitGlobeRenderer {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera();
  private earth: Mesh; private clouds: Mesh; private atmosphere: Mesh; private stars: Points;
  private textures: Texture[] = [];
  private uniforms: Record<string, { value: unknown }>;
  constructor(canvas: HTMLCanvasElement, width: number, height: number, images: GlobeTextureImages, look: GlobeLook) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: "high-performance" });
    if (!this.renderer.capabilities.isWebGL2) throw new Error("WebGL 2 unavailable");
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color(look.space), 1);
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    const texture = (img: GlobeTextureImages["day"], srgb: boolean) => {
      const t = new Texture(img as HTMLImageElement);
      t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
      t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping;
      t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = aniso;
      t.generateMipmaps = true; t.needsUpdate = true;
      this.textures.push(t);
      return t;
    };
    // A missing optional map binds the day map as a placeholder; its has* flag keeps it unused.
    const day = texture(images.day, true);
    const night = images.night ? texture(images.night, true) : day, water = images.water ? texture(images.water, false) : day;
    const cloud = images.clouds ? texture(images.clouds, false) : day;
    const atmo = new Color(look.atmosphereColor);
    this.uniforms = {
      dayMap: { value: day }, nightMap: { value: night }, waterMap: { value: water }, cloudMap: { value: cloud },
      hasNight: { value: images.night ? 1 : 0 }, hasWater: { value: images.water ? 1 : 0 },
      hasClouds: { value: images.clouds && look.clouds ? 1 : 0 }, nightLights: { value: look.nightLights ? 1 : 0 },
      sunDir: { value: new Vector3(1, 0, 0) }, atmoColor: { value: new Vector3(atmo.r, atmo.g, atmo.b) },
      sunsetColor: { value: new Vector3(1.0, .42, .16) }, atmoStrength: { value: look.atmosphereStrength },
      cloudShift: { value: 0 }, exposure: { value: look.exposure ?? 1.75 }, shell: { value: 1.12 }, gain: { value: 1 },
    };
    const material = (fragmentShader: string, extra: Partial<ShaderMaterial> = {}, vertexShader = SURFACE_VERT) => {
      const m = new ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
      Object.assign(m, extra);
      return m;
    };
    this.earth = new Mesh(sphere(1, 384, 192), material(EARTH_FRAG));
    this.clouds = new Mesh(sphere(1.007, 256, 128), material(CLOUD_FRAG, { transparent: true, depthWrite: false }));
    this.clouds.visible = !!images.clouds && look.clouds;
    this.atmosphere = new Mesh(sphere(1.12, 128, 64), material(ATMO_FRAG, { side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending }, ATMO_VERT));
    const field = starField();
    const pos = new Float32Array(field.length * 3), size = new Float32Array(field.length), tint = new Float32Array(field.length * 3);
    const px = height / 540;
    field.forEach((s, i) => {
      pos.set([s.dir[0] * 120, s.dir[1] * 120, s.dir[2] * 120], i * 3);
      size[i] = (1.6 + s.mag * 3.4) * px;
      const b = .22 + s.mag * 1.1;
      tint.set(s.warm > .82 ? [b, b * .88, b * .72] : s.warm < .18 ? [b * .82, b * .9, b] : [b, b, b], i * 3);
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3)); g.setAttribute("size", new BufferAttribute(size, 1)); g.setAttribute("tint", new BufferAttribute(tint, 3));
    this.stars = new Points(g, new ShaderMaterial({ uniforms: this.uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.stars.visible = look.stars;
    this.stars.renderOrder = 0; this.earth.renderOrder = 1; this.clouds.renderOrder = 2; this.atmosphere.renderOrder = 3;
    this.scene.add(this.stars, this.earth, this.clouds, this.atmosphere);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }
  render(f: GlobeFrame) {
    const c = this.camera;
    c.matrixWorldInverse.fromArray(f.view);
    c.matrixWorld.copy(c.matrixWorldInverse).invert();
    c.projectionMatrix.fromArray(f.projection);
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    (this.uniforms.sunDir.value as Vector3).set(f.sun[0], f.sun[1], f.sun[2]).normalize();
    this.uniforms.cloudShift.value = f.cloudShift;
    this.uniforms.gain.value = f.starGain;
    this.renderer.render(this.scene, c);
  }
  dispose() {
    for (const m of [this.earth, this.clouds, this.atmosphere, this.stars]) { m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); }
    this.textures.forEach(t => t.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
