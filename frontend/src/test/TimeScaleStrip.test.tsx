import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TimeScaleStrip } from "@/components/chart/TimeScaleStrip";

const ts = (y: number, m = 0, d = 1) => new Date(y, m, d).getTime();

describe("TimeScaleStrip", () => {
  it("renders year ticks across a wide window plus the dated Today pill", () => {
    render(
      <TimeScaleStrip
        vs={ts(2026, 3)}
        ve={ts(2033)}
        left={232}
        width={1000}
        scrollLeft={0}
      />,
    );
    const strip = screen.getByTestId("time-scale-strip");
    expect(strip).toBeInTheDocument();
    // Wide window → year labels.
    expect(screen.getByText("2027")).toBeInTheDocument();
    expect(screen.getByText("2032")).toBeInTheDocument();
    // The flag carries the actual date (system clock — assert the prefix).
    expect(screen.getByText(/^Today · \d{1,2} \w{3} \d{4}$/)).toBeInTheDocument();
    // The plot inset mirrors the chart's gutter, shifted by horizontal scroll.
    const track = strip.firstElementChild?.firstElementChild as HTMLElement;
    expect(track.style.marginLeft).toBe("232px");
    expect(track.style.width).toBe("1000px");
  });

  it("offsets the track when the chart is scrolled horizontally", () => {
    render(
      <TimeScaleStrip vs={ts(2026)} ve={ts(2027)} left={232} width={800} scrollLeft={50} />,
    );
    const strip = screen.getByTestId("time-scale-strip");
    const track = strip.firstElementChild?.firstElementChild as HTMLElement;
    expect(track.style.marginLeft).toBe("182px");
    // Month window → month labels.
    expect(screen.getByText("Feb 2026")).toBeInTheDocument();
  });

  it("hides the Today flag when today is outside the window", () => {
    render(
      <TimeScaleStrip vs={ts(2030)} ve={ts(2031)} left={0} width={800} scrollLeft={0} />,
    );
    expect(screen.queryByText(/^Today ·/)).not.toBeInTheDocument();
  });
});
