import { forwardRef, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { ACESFilmicToneMapping, LinearToneMapping, OrthographicCamera, PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from "three";
import type { Scene } from "three";
import type { EvaluationResult, MotionTimeline } from "./types";
import { evaluateCameraRig3D } from "./camera-rig-3d";
import { evaluateCameraPose3D } from "./camera-pose-3d";
import { usePrefersReducedMotion } from "./react";
import { selectCameraLightingProjection, type CameraLightingBounds, type CameraLightingPreset } from "./camera-lighting-preset";
import { createCameraLightingThreeController } from "../craft/camera-lighting-three";
import { CameraLightingPreviewContext, cameraLightingShotBounds } from "./camera-lighting-preview";

export interface CameraScene3D {
  scene: Scene;
  /** Set object poses from absolute frames, never delta time. */
  updateFrame?: (frame: number, evaluation?: EvaluationResult) => void;
  /** Called after transforms/camera matrices are current, including on resize. */
  afterRender?: (context: { camera: PerspectiveCamera; frame: number; width: number; height: number }) => void;
  /** General pose cameras, including orthographic. Legacy afterRender stays perspective-only. */
  afterCameraRender?: (context: { camera: PerspectiveCamera | OrthographicCamera; frame: number; width: number; height: number }) => void;
  /** Consumer owns geometries, materials and textures; release them here. */
  dispose: () => void;
}

export interface CameraViewport3DProps extends ComponentPropsWithoutRef<"div"> {
  timeline: MotionTimeline;
  frame: number;
  cameraId?: string;
  cameraMode?: "orbit" | "pose";
  /** Memoize this factory; a new identity replaces and disposes the scene. */
  createScene: () => CameraScene3D;
  width: number;
  height: number;
  near?: number;
  far?: number;
  exposure?: number;
  /** ACES for authored 3D (default); linear preserves baked photographic colors at exposure 1. */
  toneMapping?: "aces" | "linear";
  pixelRatio?: number;
  ariaLabel?: string;
  reducedMotion?: boolean;
  overlay?: ReactNode;
  /** Redraw changed scene inputs while paused, without replacing its resources. */
  sceneRevision?: unknown;
  /** Optional shared MG1 result for camera and object adapters; never owns time. */
  evaluation?: EvaluationResult;
  /** Preview-only, opt-in zoom UI. Dolly toward the authored focus (or adjust
   * orthographic scale); never mutates timeline or the exported camera pose. */
  zoomControls?: boolean;
  /** Opt-in portable camera and lighting rig; omit to keep authored camera/lights unchanged. */
  cameraLightingPreset?: CameraLightingPreset;
  /** Required when a preset is applied: authoritative bounds of the viewed subject. */
  cameraLightingBounds?: CameraLightingBounds;
  /** Set false for baked 2.5D images: camera and exposure only. */
  cameraLightingPhysicalLights?: boolean;
}

/** Optional Three.js boundary. Rendering occurs only on frame/size changes. */
export const CameraViewport3D = forwardRef<HTMLDivElement, CameraViewport3DProps>(function CameraViewport3D({
  timeline, frame, cameraId = "camera3d", cameraMode = "orbit", createScene, width, height, near = 0.05, far = 200,
  exposure = 1, toneMapping = "aces", pixelRatio = 1.5, ariaLabel = "3D camera scene", reducedMotion, overlay, sceneRevision, evaluation,
  zoomControls = false, cameraLightingPreset, cameraLightingBounds, cameraLightingPhysicalLights = true, children, style, ...props
}, ref) {
  const previewPreset = useContext(CameraLightingPreviewContext);
  const appliedPreset = cameraLightingPreset ?? previewPreset;
  const prefersReduced = usePrefersReducedMotion();
  const resolvedFrame = (reducedMotion ?? prefersReduced) ? timeline.durationFrames - 1 : frame;
  const pose = useMemo(() => cameraMode === "pose" ? evaluateCameraPose3D(timeline, resolvedFrame, cameraId, evaluation) : evaluateCameraRig3D(timeline, resolvedFrame, cameraId, evaluation), [timeline, resolvedFrame, cameraId, cameraMode, evaluation]);
  const appliedBounds = useMemo(() => cameraLightingBounds ?? (previewPreset && !cameraLightingPreset
    ? cameraLightingShotBounds(pose.position, "projection" in pose ? pose.focus : pose.target) : undefined),
  [cameraLightingBounds, previewPreset, cameraLightingPreset, pose]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<{ renderer: WebGLRenderer; camera: PerspectiveCamera; orthographic?: OrthographicCamera;
    content: CameraScene3D; rig?: ReturnType<typeof createCameraLightingThreeController> } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);

  if (![width, height, near, far, exposure, pixelRatio].every(Number.isFinite) || width <= 0 || height <= 0 || near <= 0 || far <= near || exposure <= 0 || pixelRatio <= 0) {
    throw new Error("Invalid 3D viewport. Use positive finite dimensions, exposure and pixel ratio, with 0 < near < far.");
  }

  drawRef.current = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { renderer, content } = runtime;
    let camera: PerspectiveCamera | OrthographicCamera = runtime.camera;
    const canvas = renderer.domElement;
    const renderWidth = Math.max(1, canvas.clientWidth);
    const renderHeight = Math.max(1, canvas.clientHeight);
    const resolution = Math.min(2, pixelRatio);
    if (renderer.getPixelRatio() !== resolution) renderer.setPixelRatio(resolution);
    if (canvas.width !== Math.floor(renderWidth * resolution) || canvas.height !== Math.floor(renderHeight * resolution)) {
      renderer.setSize(renderWidth, renderHeight, false);
    }
    renderer.toneMapping = toneMapping === "linear" ? LinearToneMapping : ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    if (appliedPreset && !appliedBounds) throw new Error("cameraLightingBounds is required when applying a camera lighting preset");
    if ("projection" in pose) {
      if (pose.projection.kind === "orthographic") {
        camera = runtime.orthographic ??= new OrthographicCamera();
        const halfHeight = pose.projection.scale / (2 * zoom);
        camera.left = -halfHeight * width / height; camera.right = -camera.left;
        camera.top = halfHeight; camera.bottom = -halfHeight;
      } else { runtime.camera.aspect = width / height; runtime.camera.fov = pose.projection.fov; }
      // Preview zoom is a *dolly* around the authored focus: the subject stays
      // framed without a wide-angle/FOV change or a second camera timeline.
      const position = pose.projection.kind === "orthographic" ? pose.position :
        pose.position.map((value, axis) => pose.focus[axis] + (value - pose.focus[axis]) / zoom);
      camera.position.set(position[0], position[1], position[2]);
      camera.quaternion.set(...pose.orientation);
      camera.near = pose.near; camera.far = pose.far;
    } else {
    runtime.camera.aspect = width / height;
    // Preserve horizontal subject coverage when switching to portrait output.
    runtime.camera.fov = 2 * Math.atan(Math.tan(pose.fov * Math.PI / 360) / Math.min(1, runtime.camera.aspect)) * 180 / Math.PI;
    camera.near = near;
    camera.far = far;
    camera.position.set(...pose.position.map((value, axis) => pose.target[axis] + (value - pose.target[axis]) / zoom) as [number, number, number]);
    camera.up.set(0, 1, 0);
    camera.lookAt(...pose.target);
    camera.rotateZ(pose.roll * Math.PI / 180);
    }
    if (appliedPreset && appliedBounds) {
      const desiredProjection = selectCameraLightingProjection(appliedPreset,
        "projection" in pose ? pose.projection.kind : "perspective");
      if (desiredProjection === "orthographic") {
        camera = runtime.orthographic ??= new OrthographicCamera();
        // Preserve the viewport's width:height ratio for portable orthographic scaling.
        camera.left = -width / height; camera.right = width / height;
        camera.top = 1; camera.bottom = -1;
      } else camera = runtime.camera;
      const authored = "projection" in pose
        ? { position: pose.position, target: pose.focus, orientation: pose.orientation, projection: pose.projection }
        : { position: pose.position, target: pose.target, fov: runtime.camera.fov, rollDeg: pose.roll };
      runtime.rig ??= createCameraLightingThreeController(content.scene, { physicalLights: cameraLightingPhysicalLights });
      const result = runtime.rig.apply(camera, appliedPreset, appliedBounds, authored,
        { physicalLights: cameraLightingPhysicalLights });
      renderer.toneMappingExposure = previewPreset && !cameraLightingPreset
        ? result.exposure * exposure : result.exposure;
    } else if (runtime.rig) {
      runtime.rig.dispose(); runtime.rig = undefined;
    }
    camera.updateProjectionMatrix();
    content.updateFrame?.(resolvedFrame, evaluation);
    renderer.render(content.scene, camera);
    if (camera instanceof PerspectiveCamera) content.afterRender?.({ camera, frame: resolvedFrame, width, height });
    content.afterCameraRender?.({ camera, frame: resolvedFrame, width, height });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer | undefined;
    let content: CameraScene3D | undefined;
    const draw = () => {
      try { drawRef.current(); }
      catch (cause) { setError(`3D preview could not render: ${cause instanceof Error ? cause.message : String(cause)}. Check the scene's frame updater and retry.`); }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      setError("The graphics context was lost. Retry the preview or close other GPU-heavy tabs.");
    };
    const restored = () => { setError(null); draw(); };
    const observer = new ResizeObserver(draw);
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
      renderer.localClippingEnabled = true;
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      content = createScene();
      runtimeRef.current = { renderer, camera: new PerspectiveCamera(), content };
      setError(null);
      canvas.addEventListener("webglcontextlost", lost);
      canvas.addEventListener("webglcontextrestored", restored);
      observer.observe(canvas);
      draw();
    } catch (cause) {
      setError(`3D preview unavailable: ${cause instanceof Error ? cause.message : String(cause)}. Enable WebGL2/hardware acceleration and retry.`);
    }
    return () => {
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      const current = runtimeRef.current;
      runtimeRef.current = null;
      try { current?.rig?.dispose(); content?.dispose(); } finally { renderer?.dispose(); }
    };
  }, [createScene, attempt]);

  useEffect(() => {
    try { drawRef.current(); }
    catch (cause) { setError(`3D frame failed: ${cause instanceof Error ? cause.message : String(cause)}. Check the camera and scene inputs.`); }
  }, [pose, zoom, resolvedFrame, width, height, near, far, exposure, toneMapping, pixelRatio, sceneRevision, appliedPreset, appliedBounds, cameraLightingPhysicalLights]);

  return (
    <div ref={ref} data-km-camera-viewport-3d="" data-km-physical-lights={cameraLightingPhysicalLights ? "true" : "false"} data-camera-frame={resolvedFrame}
      data-camera-preview-zoom={zoom.toFixed(2)}
      style={{ position: "relative", width: "100%", aspectRatio: `${width}/${height}`, overflow: "hidden", ...style }} {...props}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }} />
      {overlay != null ? <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>{overlay}</div> : null}
      {zoomControls && !appliedPreset && !error ? <div role="group" aria-label="3D zoom controls"
        style={{ position: "absolute", right: 12, bottom: 12, zIndex: 2, display: "flex", alignItems: "center",
          gap: 7, padding: "7px 9px", borderRadius: 10, background: "rgba(11,20,26,.88)",
          color: "#f2f6f5", border: "1px solid rgba(217,231,229,.3)", fontFamily: "sans-serif",
          fontSize: 12, boxShadow: "0 6px 24px rgba(0,0,0,.2)" }}>
        <button type="button" aria-label="Zoom out" disabled={zoom <= .5}
          onClick={() => setZoom(value => Math.max(.5, Math.round((value - .25) * 100) / 100))}
          style={{ background: "transparent", color: "inherit", border: "1px solid #647780",
            borderRadius: 6, minWidth: 30, minHeight: 30, cursor: "pointer" }}>−</button>
        <input aria-label="Zoom level" type="range" min="50" max="250" step="5"
          value={Math.round(zoom * 100)} onChange={event => setZoom(Number(event.target.value) / 100)}
          style={{ width: 96, accentColor: "#a6cfbd" }} />
        <button type="button" aria-label="Zoom in" disabled={zoom >= 2.5}
          onClick={() => setZoom(value => Math.min(2.5, Math.round((value + .25) * 100) / 100))}
          style={{ background: "transparent", color: "inherit", border: "1px solid #647780",
            borderRadius: 6, minWidth: 30, minHeight: 30, cursor: "pointer" }}>+</button>
        <button type="button" aria-label="Reset zoom" onClick={() => setZoom(1)}
          style={{ background: "transparent", color: "inherit", border: 0, minWidth: 44,
            padding: "5px 1px", cursor: "pointer", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(zoom * 100)}%
        </button>
      </div> : null}
      {error ? <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 12, padding: 24, background: "var(--km-surface-default, white)", color: "var(--km-text-primary, black)" }}>
        <p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry 3D preview</button>
      </div> : null}
      {children}
    </div>
  );
});
