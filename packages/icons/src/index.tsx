/**
 * Tiny icon set for React Lens — simple strokes that read at 12–16px, colored
 * via `currentColor`. One concept per icon (DESIGN §149).
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 14, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** React Lens mark — a lens/aperture. */
export function IconLens(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Renders / performance. */
export function IconBolt(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Doctor / diagnostics. */
export function IconDoctor(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 2v3.5a3 3 0 0 0 6 0V2" />
      <path d="M8 8.5v2.5a3 3 0 0 0 5 0" />
      <circle cx="13" cy="10.5" r="1.4" />
    </Svg>
  );
}

/** Record. */
export function IconRecord(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Search. */
export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m11 11 3 3" />
    </Svg>
  );
}

/** Diff / compare. */
export function IconDiff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2v8M4 12.5v1.5M4 10a2 2 0 0 0 2 2h2" />
      <path d="M12 14V6M12 3.5V2M12 6a2 2 0 0 0-2-2H8" />
    </Svg>
  );
}
