import { forwardRef } from "react";

import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Rotary table, top view — the drilling "rotary wheel": rim with SIX drive
 * spikes radiating OUTWARD (external detail survives tiny sizes better than
 * inner ticks) and the kelly-drive square in the centre keeping it
 * unmistakably drilling. Drawn to lucide's 24×24 stroke grammar so it sits
 * beside the stock icons in CHECK_META; the canvas twin lives in
 * lib/check-icon-svg.ts (keep the two path sets identical).
 */
export const RotaryTable = forwardRef<SVGSVGElement, LucideProps>(
  ({ color = "currentColor", size = 24, strokeWidth = 2, ...rest }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx="12" cy="12" r="7" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
      <path d="M12 1.5V5" />
      <path d="M12 19v3.5" />
      <path d="m21.09 6.75-3.03 1.75" />
      <path d="m2.91 6.75 3.03 1.75" />
      <path d="m21.09 17.25-3.03-1.75" />
      <path d="m2.91 17.25 3.03-1.75" />
    </svg>
  ),
) as LucideIcon;
RotaryTable.displayName = "RotaryTable";
