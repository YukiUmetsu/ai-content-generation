import type { MaskSample } from "./masks";

/** Internal SVG boundary shared by DOM reveals and scene compositions.
 * The evaluator owns geometry; this adapter only draws its resolved sample.
 */
export function SvgMaskDefinition({ id, sample }: { id: string; sample: MaskSample }) {
  const points = sample.polygon
    .map(({ x, y }) => `${Number(x.toFixed(3))},${Number(y.toFixed(3))}`)
    .join(" ");

  if (sample.kind === "clip" && sample.feather === 0) {
    return (
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        <polygon points={points} />
      </clipPath>
    );
  }

  // Gaussian blur must have room outside the authored polygon. Default SVG
  // object-bounds regions can crop a transformed matte or its soft edge.
  const pad = Math.max(1, sample.feather * 3);
  const region = {
    x: sample.bounds.x - pad,
    y: sample.bounds.y - pad,
    width: Math.max(1, sample.bounds.width + pad * 2),
    height: Math.max(1, sample.bounds.height + pad * 2),
  };
  const filterId = `${id}-feather`;
  const feathered = sample.feather > 0;

  return (
    <mask
      id={id}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      style={{ maskType: sample.kind === "luma" ? "luminance" : "alpha" }}
      {...region}
    >
      {feathered ? (
        <defs>
          <filter id={filterId} filterUnits="userSpaceOnUse" {...region}>
            <feGaussianBlur stdDeviation={sample.feather / 2} />
          </filter>
        </defs>
      ) : null}
      <polygon
        points={points}
        fill="white"
        opacity={sample.opacity}
        filter={feathered ? `url(#${filterId})` : undefined}
      />
    </mask>
  );
}
