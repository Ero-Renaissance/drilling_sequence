import * as React from "react";
import { Input } from "@/components/ui/input";

/** Owned numeric field replacing native type="number", which admits the
 *  scientific-notation characters (e/E/+/-) and lets the visible text disagree
 *  with the parsed state ("761e3" displayed, 761000 — or nothing — submitted).
 *
 *  - A text input with an allow-list: every edit (keystroke or paste) must be
 *    all digits (integer) or a single-dot decimal, else the field is left
 *    untouched. No `e`, no signs, ever.
 *  - The visible text is the draft; the parent receives the parsed, clamped
 *    value on every valid edit — display and state cannot diverge.
 *  - Blur normalizes: out-of-range text snaps to the clamped value; an emptied
 *    field either commits "" (allowEmpty) or restores the previous value.
 */
interface NumericInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type" | "min" | "max"
  > {
  value: number | "";
  onValueChange: (v: number | "") => void;
  integer?: boolean;
  min?: number;
  max?: number;
  /** When false, an emptied field restores the previous value on blur —
   *  for fields that must always hold a number (assumptions). Default true. */
  allowEmpty?: boolean;
}

export function NumericInput({
  value,
  onValueChange,
  integer = false,
  min,
  max,
  allowEmpty = true,
  onFocus,
  onBlur,
  ...props
}: NumericInputProps) {
  const [draft, setDraft] = React.useState(value === "" ? "" : String(value));
  const focused = React.useRef(false);

  // Adopt external value changes (CSV load, row resets) unless the user is
  // mid-edit — their in-progress text wins until blur.
  React.useEffect(() => {
    if (!focused.current) setDraft(value === "" ? "" : String(value));
  }, [value]);

  const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/;
  const clamp = (n: number) =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));

  return (
    <Input
      {...props}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (!pattern.test(next)) return;
        setDraft(next);
        // "" and a bare "." are incomplete, not numbers — commit empty (when
        // allowed) and let blur settle the rest.
        if (next === "" || next === ".") {
          if (allowEmpty) onValueChange("");
          return;
        }
        onValueChange(clamp(Number(next)));
      }}
      onBlur={(e) => {
        focused.current = false;
        if (draft === "" || draft === ".") {
          if (allowEmpty) setDraft("");
          else setDraft(value === "" ? "" : String(value));
        } else {
          const n = clamp(Number(draft));
          setDraft(String(n));
          if (n !== value) onValueChange(n);
        }
        onBlur?.(e);
      }}
    />
  );
}
