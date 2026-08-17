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

/** Copy to clipboard. */
export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" />
      <path d="M3.5 10.5V3.5A1 1 0 0 1 4.5 2.5h7" />
    </Svg>
  );
}

/** DOM highlight / crosshair. */
export function IconCrosshair(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M8 1.5v2.5M8 12v2.5M1.5 8h2.5M12 8h2.5" />
    </Svg>
  );
}

/** Play. */
export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 3.5v9l8-4.5z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Pause. */
export function IconPause(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Skip to previous. */
export function IconSkipBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 3.5v9" />
      <path d="M12.5 3.5v9L5.5 8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Skip to next. */
export function IconSkipForward(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.5 3.5v9" />
      <path d="M3.5 3.5v9L10.5 8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Zoom out / minus. */
export function IconMinus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8h9" />
    </Svg>
  );
}

/** Zoom in / plus. */
export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Svg>
  );
}

/** Fit session to viewport width — square with center mark. */
export function IconFitWidth(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="10" height="10" rx="1.2" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Fit selection to viewport — four corner brackets. */
export function IconFitSelection(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5.5V3h2.5M13 5.5V3h-2.5M3 10.5V13h2.5M13 10.5V13h-2.5" />
    </Svg>
  );
}

/** Collapsed / next. */
export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 3.5 5 4.5-5 4.5" />
    </Svg>
  );
}

/** Previous. */
export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m10 3.5-5 4.5 5 4.5" />
    </Svg>
  );
}

/** Expanded. */
export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3.5 6 4.5 5 4.5-5" />
    </Svg>
  );
}

/** Close / dismiss. */
export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 4 8 8M12 4 4 12" />
    </Svg>
  );
}

/** Comparison mark A. */
export function IconMarkA(props: IconProps) {
  return (
    <Svg {...props}>
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="9"
        fontWeight="600"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        A
      </text>
    </Svg>
  );
}

/** Comparison mark B. */
export function IconMarkB(props: IconProps) {
  return (
    <Svg {...props}>
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontSize="9"
        fontWeight="600"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        B
      </text>
    </Svg>
  );
}

/** Export / download session. */
export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5v8" />
      <path d="m4.5 7.5 3.5 3.5 3.5-3.5" />
      <path d="M3 12.5h10" />
    </Svg>
  );
}

/** Import / upload session. */
export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 12.5v-8" />
      <path d="m4.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M3 12.5h10" />
    </Svg>
  );
}

/** Time travel — a counter-clockwise history arrow. */
export function IconRewind(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8a5 5 0 1 1 1.5 3.6" />
      <path d="M3 8V5M3 8h3" />
    </Svg>
  );
}

/** AI assistant — a four-point sparkle. */
export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M8 2.5c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M12.6 10.4c.25 1.3.7 1.75 2 2-1.3.25-1.75.7-2 2-.25-1.3-.7-1.75-2-2 1.3-.25 1.75-.7 2-2z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}

/** Follow latest interaction — live target ring. */
export function IconLive(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="5.2" />
    </Svg>
  );
}

/** Panel settings — two tune sliders. */
export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 5.5h11M2.5 10.5h11" />
      <circle cx="6" cy="5.5" r="1.7" fill="var(--rl-bg, #0b0d10)" />
      <circle cx="10" cy="10.5" r="1.7" fill="var(--rl-bg, #0b0d10)" />
    </Svg>
  );
}

/** Active lane filter. */
export function IconFilter(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3.5h10l-3.5 5v4.2l-3 1.6V8.5z" />
    </Svg>
  );
}

/** Upstream / cause. */
export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 12.6V3.4M4.4 7 8 3.4 11.6 7" />
    </Svg>
  );
}

/** Downstream / effects. */
export function IconArrowDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3.4v9.2M4.4 9 8 12.6 11.6 9" />
    </Svg>
  );
}

/** Collapse expanded groups. */
export function IconCollapse(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M5.2 8h5.6" />
    </Svg>
  );
}

/** Stop playback. */
export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}
