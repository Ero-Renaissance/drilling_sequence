import * as React from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { useCheckDef } from "./catalog";
import { STATUS_DOT, STATUS_ICON_COLOR, STATUS_LABEL, statusesOf } from "./check-meta";
import { checkIcon } from "./icon-registry";

export { STATUS_DOT, STATUS_ICON_COLOR };

// The pickable statuses come from the check's status set (statusesOf): the
// standard set keeps N/A selectable so a planner can mark a single gate "not
// applicable" even when the activity still requires readiness — an N/A gate is
// excluded from the rollups — and availability checks offer Available / Not
// available.

interface BaseProps {
  code: CheckCode;
  status: CheckStatus;
  disabled?: boolean;
  /** "sm" for dense inline strips, "lg" for the dedicated grid. */
  size?: "sm" | "lg";
  /** The value is inherited from the field project (not this well's own) —
   *  rendered faded and labelled so nobody mistakes it for a well entry. */
  inherited?: boolean;
}

type ReadinessDotProps = BaseProps &
  (
    | {
        /** Open the standard status dropdown picker. */
        onChange: (status: CheckStatus) => void;
        /** When set, the picker offers "Reset to project" (drop this well's own
         *  value so it follows its field project again). */
        onReset?: () => void;
      }
    | {
        /** Display only — no interaction. Used for frozen snapshots. */
        onChange?: never;
      }
  );

type IconButtonProps = BaseProps & {
  onClick?: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      code,
      status,
      disabled,
      size = "lg",
      inherited = false,
      onClick,
      ...rest
    },
    ref,
  ) {
    const meta = useCheckDef(code);
    const Icon = checkIcon(meta.icon_key);
    const title = `${meta.label}: ${STATUS_LABEL[status]}${inherited ? " (from field project)" : ""}`;
    const iconSize = size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4";
    const buttonSize = size === "lg" ? "h-7 w-7" : "h-6 w-6";

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={title}
        aria-label={`${title}. Click to change.`}
        className={cn(
          "group inline-flex items-center justify-center rounded-md transition-colors",
          "hover:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          buttonSize,
        )}
        {...rest}
      >
        <Icon
          className={cn(
            "transition-transform group-hover:scale-110",
            iconSize,
            STATUS_ICON_COLOR[status],
            inherited && "opacity-50",
          )}
          strokeWidth={2}
        />
      </button>
    );
  },
);

export function ReadinessDot(props: ReadinessDotProps) {
  const { code, status, disabled, size = "lg", inherited = false } = props;
  // Label + icon come from the catalog in context (a revision pins its own).
  const meta = useCheckDef(code);
  const Icon = checkIcon(meta.icon_key);

  // Display-only — no handler at all. Just render the icon.
  if (!("onChange" in props && props.onChange)) {
    const iconSize = size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4";
    const buttonSize = size === "lg" ? "h-7 w-7" : "h-6 w-6";
    return (
      <span
        title={`${meta.label}: ${STATUS_LABEL[status]}${inherited ? " (from field project)" : ""}`}
        className={cn(
          "inline-flex items-center justify-center",
          buttonSize,
        )}
      >
        <Icon
          className={cn(iconSize, STATUS_ICON_COLOR[status], inherited && "opacity-50")}
          strokeWidth={2}
        />
      </span>
    );
  }

  // Standard path — open the status picker. When disabled (e.g. the plan is
  // locked for approval), render a bare disabled button and DON'T mount the
  // dropdown: `disabled` on a Radix DropdownMenuTrigger child does not reliably
  // stop the menu from opening, so the only safe lock is to not mount it at all.
  const { onChange, onReset } = props as {
    onChange: (s: CheckStatus) => void;
    onReset?: () => void;
  };

  if (disabled) {
    return <IconButton code={code} status={status} disabled size={size} inherited={inherited} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          code={code}
          status={status}
          disabled={disabled}
          size={size}
          inherited={inherited}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-48">
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </div>
        <div className="my-1 h-px bg-border" />
        {statusesOf(meta.status_set).map((s) => {
          const selected = s === status;
          return (
            <DropdownMenuItem
              key={s}
              onClick={() => {
                if (!selected) onChange(s);
              }}
              className={cn("gap-2.5 py-2", selected && "bg-accent/50")}
            >
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_DOT[s])} />
              <span className="flex-1">{STATUS_LABEL[s]}</span>
              {selected && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
        {onReset && (
          <>
            <div className="my-1 h-px bg-border" />
            <DropdownMenuItem onClick={onReset} className="gap-2.5 py-2">
              <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">Reset to project</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
