import { forwardRef } from "react";

import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Rotary table, top view — the drilling "rotary wheel": rim, kelly-drive
 * square in the centre, four drive ticks. Drawn to lucide's 24×24 stroke
 * grammar so it sits beside the stock icons in CHECK_META; the canvas twin
 * lives in lib/check-icon-svg.ts (keep the two path sets identical).
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
      <circle cx="12" cy="12" r="9" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="0.5" />
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
    </svg>
  ),
) as LucideIcon;
RotaryTable.displayName = "RotaryTable";
