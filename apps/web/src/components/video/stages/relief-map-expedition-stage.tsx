/**
 * Relief-Map Expedition. Causal beat:
 *   input      a licensed elevation model, a geographic route and a destination
 *   transform  the terrain is lit by a low oblique sun (cast shadows, sky
 *              occlusion); the camera descends once from overhead to an
 *              oblique view; the route traces over the actual surface
 *   output     the destination is held with its label and readout.
 * Real terrain geometry (a WebGL heightfield mesh with model-block skirts); the
 * route and labels are projected through the same camera every frame. Vertical
 * exaggeration is declared on screen whenever it is not 1. No clock: the GL
 * canvas redraws on the host's frame and reports it in data-km-gl-frame.
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SceneTemplateFrame, SceneTemplateSpec } from "../scene-templates";
import type { AnnotationBeats, SubjectAnnotation } from "../subject-annotations";
import { annotationState } from "../subject-annotations";
import { SubjectAnnotationLayer } from "../subject-annotations-react";
import { bakeRelief, cameraPosition, decodeTerrarium, defaultPalette, drapeRoute, geoToWorld, occluded, overheadCamera,
  projectToStage, reliefCameraAtFrame, reliefFrame, uvToWorld, viewProjection } from "../relief-terrain";
import type { ReliefCamera, ReliefFrame, Vec3 } from "../relief-terrain";
import { FilmFinish, KineticWords, OverlayRendererContext, RiseIn, cueAt, fitLongestWord } from "./stage-kit";

type Content = SceneTemplateSpec<"relief-map-expedition">["content"];
interface LoadedRelief { relief: ReliefFrame; baked: Uint8ClampedArray }
const cache = new Map<string, Promise<LoadedRelief>>();
const bakeKey = (c: Content) => JSON.stringify([c.terrain.heightmap.src, c.terrain.bounds, c.terrain.projection, c.verticalExaggeration, c.light, c.palette, c.water]);
function loadRelief(c: Content): Promise<LoadedRelief> {
  const key = bakeKey(c);
  let job = cache.get(key);
  if (!job) {
    job = new Promise<LoadedRelief>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) { reject(new Error("2D canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0);
        const field = decodeTerrarium(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        const relief = reliefFrame(field, c.terrain.bounds, c.terrain.projection ?? "web-mercator", c.verticalExaggeration);
        const baked = bakeRelief(relief, c.light ?? { azimuth: 250, altitude: 24 }, c.palette ?? defaultPalette(field.min, field.max), c.water);
        resolve({ relief, baked });
      };
      img.onerror = () => reject(new Error("Elevation model could not be loaded."));
      img.src = c.terrain.heightmap.src;
    });
    cache.set(key, job);
    job.catch(() => cache.delete(key));
  }
  return job;
}
function useRelief(c: Content): { data?: LoadedRelief; error?: string } {
  const key = bakeKey(c);
  const [state, setState] = useState<{ key: string; data?: LoadedRelief; error?: string }>({ key });
  useEffect(() => {
    let live = true;
    loadRelief(c).then(data => live && setState({ key, data }), e => live && setState({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
    // The key captures every input the bake reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : {};
}

/** Haze colour the far terrain recedes into. */
const FOG: [number, number, number] = [.62, .69, .76];
const VERT = `#version 300 es
in vec3 position; in vec2 uv; in float shade;
uniform mat4 matrix; uniform vec3 eye;
out vec2 vUv; out float vShade; out float vDist; out float vY;
void main(){ vUv=uv; vShade=shade; vY=position.y; vDist=distance(position,eye); gl_Position=matrix*vec4(position,1.); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; in float vShade; in float vDist; in float vY;
uniform sampler2D tex; uniform vec3 fogColor; uniform float fogDensity; uniform float fogStart; uniform float baseY; uniform float topY;
out vec4 color;
void main(){
  vec3 c;
  if(vShade<.5) c=texture(tex,vUv).rgb;
  else {
    // Model-block sides: layered earth, darker towards the base.
    float t=clamp((vY-baseY)/max(.001,topY-baseY),0.,1.);
    c=mix(vec3(.07,.055,.05),vec3(.36,.29,.22),pow(t,.8))*(vShade-.5);
    c*=.88+.12*smoothstep(.35,.65,fract(vY*5.));
  }
  // Haze starts near the subject, so only what lies beyond it recedes.
  float f=1.-exp(-pow(max(0.,vDist-fogStart)*fogDensity,2.));
  color=vec4(mix(c,fogColor,f*.55),1.);
}`;
/** Heightfield mesh plus skirts down to a common base. */
function buildMesh(r: ReliefFrame, grid = 288) {
  const top = grid * grid, ring = 4 * (grid - 1);
  const pos = new Float32Array((top + ring * 2) * 3), uv = new Float32Array((top + ring * 2) * 2), shade = new Float32Array(top + ring * 2);
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const i = y * grid + x, u = x / (grid - 1), v = y / (grid - 1), p = uvToWorld(r, u, v);
    pos.set(p, i * 3); uv.set([u, v], i * 2);
  }
  const idx: number[] = [];
  for (let y = 0; y < grid - 1; y++) for (let x = 0; x < grid - 1; x++) {
    const a = y * grid + x, b = a + 1, c = a + grid, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const baseY = (r.field.min / 1000 - (r.field.max - r.field.min) / 1000 * .22) * r.exaggeration;
  // Border walk (clockwise from north-west) with a per-side brightness: south faces the default camera.
  const border: { i: number; side: number }[] = [];
  for (let x = 0; x < grid - 1; x++) border.push({ i: x, side: .9 });
  for (let y = 0; y < grid - 1; y++) border.push({ i: y * grid + grid - 1, side: 1.25 });
  for (let x = grid - 1; x > 0; x--) border.push({ i: (grid - 1) * grid + x, side: 1.5 });
  for (let y = grid - 1; y > 0; y--) border.push({ i: y * grid, side: 1.1 });
  border.forEach((b, k) => {
    const t = top + k * 2;
    pos.set(pos.subarray(b.i * 3, b.i * 3 + 3), t * 3);
    pos.set([pos[b.i * 3], baseY, pos[b.i * 3 + 2]], (t + 1) * 3);
    shade[t] = shade[t + 1] = b.side;
  });
  for (let k = 0; k < border.length; k++) {
    const a = top + k * 2, n = top + ((k + 1) % border.length) * 2;
    idx.push(a, n, a + 1, n, n + 1, a + 1);
  }
  return { pos, uv, shade, index: new Uint32Array(idx), baseY, topY: r.field.max / 1000 * r.exaggeration };
}
interface GLState { gl: WebGL2RenderingContext; draw: (m: Float32Array, eye: Vec3, focus: Vec3) => void }
function ReliefCanvas({ data, matrix, eye, focus, frame, pixelWidth, pixelHeight, fog }: {
  data: LoadedRelief; matrix: Float32Array; eye: Vec3; focus: Vec3; frame: number; pixelWidth: number; pixelHeight: number; fog: [number, number, number];
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const state = useRef<GLState | null>(null);
  const latest = useRef({ matrix, eye, focus, frame });
  latest.current = { matrix, eye, focus, frame };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    const gl = el?.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true });
    if (!el || !gl) { setFailed(true); return; }
    const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    const mesh = buildMesh(data.relief);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const attr = (name: string, array: Float32Array, size: number) => {
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr("position", mesh.pos, 3); attr("uv", mesh.uv, 2); attr("shade", mesh.shade, 1);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const { width: tw, height: th } = data.relief.field;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.baked);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    const u = (n: string) => gl.getUniformLocation(program, n);
    const draw = (m: Float32Array, e: Vec3, focus: Vec3) => {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.useProgram(program); gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(u("matrix"), false, m); gl.uniform3fv(u("eye"), e);
      gl.uniform3fv(u("fogColor"), fog); gl.uniform1f(u("fogDensity"), 1 / (Math.max(data.relief.widthKm, data.relief.depthKm) * 2.2));
      gl.uniform1f(u("fogStart"), Math.hypot(e[0] - focus[0], e[1] - focus[1], e[2] - focus[2]) * .85); gl.uniform1f(u("baseY"), mesh.baseY); gl.uniform1f(u("topY"), mesh.topY);
      gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_INT, 0);
    };
    state.current = { gl, draw };
    draw(latest.current.matrix, latest.current.eye, latest.current.focus);
    el.setAttribute("data-km-gl-frame", String(latest.current.frame));
    return () => { state.current = null; gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [data, fog]);
  useLayoutEffect(() => {
    if (!state.current || !canvas.current) return;
    state.current.draw(matrix, eye, focus);
    canvas.current.setAttribute("data-km-gl-frame", String(frame));
  });
  if (failed) return <div role="status" data-km-terrain-state="unavailable" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: ".8em", opacity: .8 }}>
    WebGL 2 is unavailable, so the terrain cannot be drawn.</div>;
  // Drawing buffer is fixed to twice the composition size, so preview and export match.
  return <canvas ref={canvas} width={pixelWidth} height={pixelHeight} aria-hidden="true"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}/>;
}

export function ReliefMapExpeditionStage({ spec, f }: { spec: SceneTemplateSpec<"relief-map-expedition">; f: SceneTemplateFrame }) {
  const c = spec.content, w = spec.width, h = spec.height, portrait = h > w, t = f.frame, reduced = f.reducedMotion;
  const dock = cueAt(f, 0), reveal = cueAt(f, 1), resolve = cueAt(f, 2);
  const { data, error } = useRelief(c);
  const aspect = w / h;
  const geometry = useMemo(() => {
    if (!data) return undefined;
    const r = data.relief;
    const route = drapeRoute(r, c.route.points, .08, 25, c.route.smoothing ?? .6);
    const dest = geoToWorld(r, c.destination.latitude, c.destination.longitude, 25);
    const xs = route.map(p => p[0]).concat(dest[0]), zs = route.map(p => p[2]).concat(dest[2]), ys = route.map(p => p[1]).concat(dest[1]);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1.5);
    const yaw = c.camera?.yaw ?? 0, pitch = c.camera?.pitch ?? 31, fov = 30;
    const half = Math.tan(fov * Math.PI / 360);
    const distance = Math.max(extent * 1.12 / (half * Math.min(aspect, 1.5)), extent * .9 / half) * (c.camera?.distanceScale ?? 1);
    // Frame the expedition right of centre in landscape (copy owns the left), centred in portrait.
    const shift = portrait ? 0 : extent * .58, right: Vec3 = [Math.cos(yaw * Math.PI / 180), 0, -Math.sin(yaw * Math.PI / 180)];
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cz = (Math.max(...zs) + Math.min(...zs)) / 2;
    // Aim high on the climb so the destination sits below the title band with sky above it.
    const oblique: ReliefCamera = { target: portrait ? [cx, Math.max(...ys) * .42, cz + extent * .2] : [cx - right[0] * shift, Math.max(...ys) * .8, cz - right[2] * shift],
      yaw, pitch, distance: portrait ? distance * .92 : distance, fov };
    const top = overheadCamera(r, aspect);
    // Landscape: the model sits right of centre, clear of the title column.
    const overhead: ReliefCamera = portrait ? { ...top, distance: top.distance * 1.08 } : { ...top, target: [-r.widthKm * .46, 0, 0], distance: top.distance * 1.3 };
    return { route, dest, overhead, oblique };
  }, [data, c.route.points, c.route.smoothing, c.destination.latitude, c.destination.longitude, c.camera, aspect, portrait]);
  const camera = geometry && reliefCameraAtFrame(t, geometry.overhead, geometry.oblique,
    { descendFrom: dock, descendTo: reveal - 6, durationFrames: f.durationFrames }, reduced);
  const matrix = camera && viewProjection(camera, aspect);
  const eye = camera && cameraPosition(camera);
  const traceEnd = reveal + Math.round((resolve - reveal) * .82);
  const beats: AnnotationBeats = { dock, reveal, resolve, durationFrames: f.durationFrames, steps: { arrive: traceEnd } };
  const marks: SubjectAnnotation[] = [];
  if (data && geometry && matrix && eye) {
    const toStage = (p: Vec3) => { const s = projectToStage(matrix, p, w, h); return { x: Math.max(0, Math.min(1, s.x / w)), y: Math.max(0, Math.min(1, s.y / h)) }; };
    // Route segments hidden behind terrain are dropped, so the trace never paints over a ridge.
    const visible = geometry.route.filter((p, i) => i % 2 === 0 && !occluded(data.relief, eye, p, 48, 120));
    // The arrowhead leads the climb; on arrival the settled line hands over to the destination ring.
    if (visible.length > 1) {
      const points = visible.map(toStage);
      marks.push({ id: "route", kind: "path", points, arrowhead: true, headingWindow: .1, maxTurn: 6, weight: 1.05, space: "stage",
        timing: { at: "reveal", enter: traceEnd - reveal, ease: "cubic", until: { step: "arrive" }, exit: 1 } });
      marks.push({ id: "route-settled", kind: "path", points, weight: 1.05, space: "stage", timing: { at: { step: "arrive" }, offset: -1, enter: 1, ease: "linear" } });
    }
    const start = toStage(geometry.route[0]), end = toStage(geometry.dest);
    marks.push({ id: "start", kind: "ring", center: start, radius: .012, weight: .8, space: "stage", timing: { at: "reveal", offset: -8, enter: 10 } });
    if (c.route.label) marks.push({ id: "start-label", kind: "label", anchor: start, text: c.route.label, side: portrait ? "below" : "left", distance: .06,
      space: "stage", timing: { at: "reveal", offset: -4, until: { step: "arrive" }, untilOffset: 24, exit: 10 } });
    marks.push({ id: "destination", kind: "ring", center: end, radius: .022, pulse: true, space: "stage", timing: { at: { step: "arrive" }, offset: -4, enter: 12, ease: "back" } });
    marks.push({ id: "destination-label", kind: "label", anchor: end, text: c.destination.label, side: "above", distance: .085,
      space: "stage", timing: { at: { step: "arrive" }, offset: 4 } });
  }
  const overlay = useContext(OverlayRendererContext);
  const look = c.look ?? {};
  const ready = !!(data && matrix && eye);
  return <div data-km-terrain-state={error ? "error" : ready ? "ready" : "loading"} style={{ position: "absolute", inset: 0, overflow: "hidden",
    background: "radial-gradient(ellipse 120% 90% at 55% 38%,#33414c 0%,#1a232b 46%,#0a0f13 100%)",
    fontSize: portrait ? "clamp(13px, 3.5cqw, 44px)" : "clamp(13px, 2cqw, 40px)" }}>
    {data && matrix && eye && <ReliefCanvas data={data} matrix={matrix} eye={eye} focus={camera!.target} frame={t} pixelWidth={w * 2} pixelHeight={h * 2} fog={FOG}/>}
    {error && <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: ".8em" }}>{error}</div>}
    {/* Copy scrims: top for the title, bottom for the readout and notes. */}
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none",
      background: portrait
        ? "linear-gradient(180deg,rgba(6,9,12,.78) 0%,rgba(6,9,12,.35) 20%,transparent 32%,transparent 70%,rgba(6,9,12,.8) 100%)"
        : "linear-gradient(100deg,rgba(6,9,12,.78) 0%,rgba(6,9,12,.42) 30%,transparent 52%),linear-gradient(0deg,rgba(6,9,12,.6) 0%,transparent 22%)" }}/>
    <FilmFinish frame={t} reduced={reduced} grain={look.grain ?? .8} vignette={look.vignette ?? 1}/>
    <div data-km-stage-overlay="" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {ready && <SubjectAnnotationLayer annotations={marks} beats={beats} subject={{}} width={w} height={h} frame={t} reducedMotion={reduced} space="stage"/>}
      {overlay?.({ frame: f, width: w, height: h, beats, space: "stage", toStage: p => ({ x: p.x * w, y: p.y * h }),
        state: timing => annotationState(timing, beats, t, reduced) })}
    </div>
    <div data-km-relief-title="" style={{ position: "absolute", left: portrait ? "7%" : "6%", top: portrait ? "6%" : "8%",
      width: portrait ? "86%" : "46%", display: "flex", flexDirection: "column", gap: ".35em", textShadow: "0 .05em .6em rgba(0,0,0,.55)" }}>
      {c.eyebrow && <RiseIn name="relief-eyebrow" frame={t} start={-8} reduced={reduced} style={{ fontSize: ".74em", fontWeight: 760,
        letterSpacing: ".16em", textTransform: "uppercase", color: "var(--km-accent, #9fd9ce)" }}>{c.eyebrow}</RiseIn>}
      <h2 style={{ margin: 0, fontSize: fitLongestWord(c.title, portrait ? 3.1 : 3.5, portrait ? 84 : 44), fontWeight: 780,
        letterSpacing: "-.04em", lineHeight: 1.02, textWrap: "balance" }}>
        <KineticWords text={c.title} start={0} stagger={3} length={18} frame={t} reduced={reduced} marker="relief"/>
      </h2>
    </div>
    <RiseIn name="relief-readout" frame={t} start={traceEnd + 6} length={18} reduced={reduced} style={{ position: "absolute",
      left: portrait ? "7%" : "6%", bottom: portrait ? "12%" : "12%", maxWidth: portrait ? "86%" : "40%", textShadow: "0 .05em .6em rgba(0,0,0,.6)" }}>
      {c.destination.detailLabel && <div style={{ fontSize: ".8em", fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--km-accent, #9fd9ce)" }}>{c.destination.detailLabel}</div>}
      {c.destination.detail && <div data-km-relief-readout="" style={{ fontSize: fitLongestWord(c.destination.detail, portrait ? 2.6 : 2.7, portrait ? 80 : 38),
        fontWeight: 760, letterSpacing: "-.035em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{c.destination.detail}</div>}
    </RiseIn>
    <RiseIn name="relief-notes" frame={t} start={dock} reduced={reduced} style={{ position: "absolute", right: portrait ? "7%" : "4.5%",
      left: portrait ? "7%" : "62%", ...(portrait ? { bottom: "3.5%" } : { top: "6%" }), textAlign: portrait ? "left" : "right",
      fontSize: ".68em", lineHeight: 1.35, color: "rgba(236,240,244,.8)", textShadow: "0 1px 6px rgba(0,0,0,.7)" }}>
      {c.verticalExaggeration !== 1 && <div data-km-relief-exaggeration="">{c.exaggerationNote}</div>}
      {c.routeNote && <div>{c.routeNote}</div>}
      {c.credit && <div style={{ opacity: .85 }}>{c.credit}</div>}
    </RiseIn>
  </div>;
}
