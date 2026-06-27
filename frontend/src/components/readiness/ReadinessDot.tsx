import * as React from "react";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { CHECK_META, STATUS_DOT, STATUS_ICON_COLOR, STATUS_LABEL } from "./check-meta";

export { STATUS_DOT, CHECK_META, STATUS_ICON_COLOR };

// The planner-pickable statuses. N/A is selectable so a planner can mark a
// single gate "not applicable" for a well even when the activity still requires
// readiness — an N/A gate is excluded from the readiness rollup (see
// dashboard.ready: only non-N/A gates count). N/A is also the automatic value
// for the CON gate when there's no contract; CON isn't picked here (its dot
// opens the contract editor), so that derived value is untouched.
const STATUSES: CheckStatus[] = ["On Track", "Behind", "Completed", "N/A"];

interface BaseProps {
  code: CheckCode;
  status: CheckStatus;
  disabled?: boolean;
  /** "sm" for dense inline strips, "lg" for the dedicated grid. */
  size?: "sm" | "lg";
}

type ReadinessDotProps = BaseProps &
  (
    | {
        /** Open the standard status dropdown picker. */
        onChange: (status: CheckStatus) => void;
        onClick?: never;
      }
    | {
        /** Override the dropdown — callers handle the click (e.g. CON opens
         *  the rig contract editor). */
        onClick: () => void;
        onChange?: never;
      }
    | {
        /** Display only — no interaction. Used for frozen snapshots. */
        onChange?: never;
        onClick?: never;
      }
  );

type IconButtonProps = BaseProps & {
  onClick?: () => void;
  asDropdownTrigger?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      code,
      status,
      disabled,
      size = "lg",
      onClick,
      asDropdownTrigger = false,
      ...rest
    },
    ref,
  ) {
    const meta = CHECK_META[code];
    const Icon = meta.icon;
    const title = `${meta.label}: ${STATUS_LABEL[status]}`;
    const iconSize = size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4";
    const buttonSize = size === "lg" ? "h-7 w-7" : "h-6 w-6";

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={title}
        aria-label={
          asDropdownTrigger ? `${title}. Click to change.` : `${title}. Click to edit contract.`
        }
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
          )}
          strokeWidth={2}
        />
      </button>
    );
  },
);

export function ReadinessDot(props: ReadinessDotProps) {
  const { code, status, disabled, size = "lg" } = props;

  // Display-only — no handler at all. Just render the icon.
  if (!("onChange" in props && props.onChange) && !("onClick" in props && props.onClick)) {
    const meta = CHECK_META[code];
    const Icon = meta.icon;
    const iconSize = size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4";
    const buttonSize = size === "lg" ? "h-7 w-7" : "h-6 w-6";
    return (
      <span
        title={`${meta.label}: ${STATUS_LABEL[status]}`}
        className={cn(
          "inline-flex items-center justify-center",
          buttonSize,
        )}
      >
        <Icon className={cn(iconSize, STATUS_ICON_COLOR[status])} strokeWidth={2} />
      </span>
    );
  }

  // Override path — caller handles the click directly.
  if ("onClick" in props && props.onClick) {
    return (
      <IconButton
        code={code}
        status={status}
        disabled={disabled}
        size={size}
        onClick={props.onClick}
      />
    );
  }

  // Standard path — open the status picker.
  const meta = CHECK_META[code];
  const Icon = meta.icon;
  const onChange = (props as { onChange: (s: CheckStatus) => void }).onChange;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          code={code}
          status={status}
          disabled={disabled}
          size={size}
          asDropdownTrigger
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={6} className="w-48">
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </div>
        <div className="my-1 h-px bg-border" />
        {STATUSES.map((s) => {
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
