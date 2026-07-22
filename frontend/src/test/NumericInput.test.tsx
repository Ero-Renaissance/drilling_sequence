import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { NumericInput } from "@/components/ui/numeric-input";

/** Controlled harness mirroring real usage; exposes the committed value. */
function Harness({
  integer = false,
  min,
  max,
  allowEmpty = true,
  initial = "" as number | "",
}: {
  integer?: boolean;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  initial?: number | "";
}) {
  const [value, setValue] = useState<number | "">(initial);
  return (
    <>
      <NumericInput
        integer={integer}
        min={min}
        max={max}
        allowEmpty={allowEmpty}
        value={value}
        onValueChange={setValue}
        data-testid="numeric"
      />
      <output data-testid="committed">{value === "" ? "(empty)" : String(value)}</output>
    </>
  );
}

describe("NumericInput", () => {
  it("rejects letters, scientific notation and signs outright", () => {
    render(<Harness initial={76} />);
    const input = screen.getByTestId("numeric");

    for (const garbage of ["76e", "76e3", "abc", "-5", "+5", "1,000"]) {
      fireEvent.change(input, { target: { value: garbage } });
      expect(input).toHaveValue("76");
      expect(screen.getByTestId("committed")).toHaveTextContent("76");
    }
  });

  it("commits valid digits and keeps display and state in lockstep", () => {
    render(<Harness />);
    const input = screen.getByTestId("numeric");
    fireEvent.change(input, { target: { value: "125" } });
    expect(input).toHaveValue("125");
    expect(screen.getByTestId("committed")).toHaveTextContent("125");
  });

  it("integer mode refuses a decimal point; decimal mode allows one dot only", () => {
    render(<Harness integer initial={3} />);
    const input = screen.getByTestId("numeric");
    fireEvent.change(input, { target: { value: "3.5" } });
    expect(input).toHaveValue("3");

    render(<Harness />);
    const dec = screen.getAllByTestId("numeric")[1];
    fireEvent.change(dec, { target: { value: "3.5" } });
    expect(dec).toHaveValue("3.5");
    fireEvent.change(dec, { target: { value: "3.5.1" } });
    expect(dec).toHaveValue("3.5");
  });

  it("clamps to max on commit and snaps the display on blur", () => {
    render(<Harness integer max={730} initial={76} />);
    const input = screen.getByTestId("numeric");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "800" } });
    // The overshoot stays visible mid-edit (focused), but the committed state
    // is already clamped; blur snaps the display to match.
    expect(input).toHaveValue("800");
    expect(screen.getByTestId("committed")).toHaveTextContent("730");
    fireEvent.blur(input);
    expect(input).toHaveValue("730");
  });

  it("empty commits as empty when allowed, restores the old value when not", () => {
    render(<Harness initial={40} />);
    const input = screen.getByTestId("numeric");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("committed")).toHaveTextContent("(empty)");
    fireEvent.blur(input);
    expect(input).toHaveValue("");

    render(<Harness allowEmpty={false} initial={76} />);
    const strict = screen.getAllByTestId("numeric")[1];
    fireEvent.change(strict, { target: { value: "" } });
    expect(screen.getAllByTestId("committed")[1]).toHaveTextContent("76");
    fireEvent.blur(strict);
    expect(strict).toHaveValue("76");
  });

  it("adopts external value changes when not focused (CSV load)", () => {
    function Loader() {
      const [value, setValue] = useState<number | "">(1);
      return (
        <>
          <NumericInput value={value} onValueChange={setValue} data-testid="numeric" />
          <button onClick={() => setValue(42)}>load</button>
        </>
      );
    }
    render(<Loader />);
    fireEvent.click(screen.getByText("load"));
    expect(screen.getByTestId("numeric")).toHaveValue("42");
  });
});
