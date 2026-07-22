import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Capture the ECharts option instead of rendering canvas in jsdom.
const captured = vi.hoisted(
  () => ({ option: undefined, onEvents: undefined }) as {
    option: unknown;
    onEvents?: {
      legendselectchanged?: (e: { selected: Record<string, boolean> }) => void;
    };
  },
);
vi.mock("echarts-for-react/lib/core", () => ({
  default: ({ option, onEvents }: { option?: unknown; onEvents?: typeof captured.onEvents }) => {
    captured.option = option;
    captured.onEvents = onEvents;
    return <div data-testid="echarts-instance" />;
  },
}));

import { CapacityChart } from "@/components/dashboard/CapacityChart";
import { aggregateCapacity } from "@/lib/campaign-capacity";
import type { Activity } from "@/api/activities";

let seq = 0;
function act(over: Partial<Activity>): Activity {
  return {
    id: `a${seq++}`,
    project_id: "p",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-06-01",
    well_name: null,
    rig_name: null,
    hwu_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: null,
    completed_at: null,
    updated_at: "",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  } as Activity;
}

interface CapturedOption {
  legend: { selected?: Record<string, boolean> };
  series: {
    name: string;
    data: number[] | { value: number; label?: { formatter?: string; show?: boolean } }[];
  }[];
}

// Two Land oil wells (one rig), one Swamp oil well (one rig).
const DATA = aggregateCapacity(
  [
    act({ well_name: "L1", rig_name: "R-L", location: "LAND" }),
    act({ well_name: "L2", rig_name: "R-L", location: "LAND" }),
    act({ well_name: "S1", rig_name: "R-S", location: "SWAMP" }),
  ],
  {},
);

function series(name: string): CapturedOption["series"][number] {
  const opt = captured.option as CapturedOption;
  const s = opt.series.find((x) => x.name === name);
  if (!s) throw new Error(`series ${name} missing`);
  return s;
}

describe("CapacityChart terrain-legend filtering", () => {
  it("deselecting a terrain re-counts the spud lines and the bar totals", async () => {
    render(<CapacityChart title="T" data={DATA} />);

    // All terrains on: 3 oil spuds, stack total 2 rigs.
    expect(series("Well spuds — Oil").data).toEqual([3]);
    const totalCell = series("total").data[0] as { label?: { formatter?: string } };
    expect(totalCell.label?.formatter).toBe("2");

    // The legend toggle is a FILTER: Land off → its 2 wells and its rig leave
    // the counts, not just the bars.
    captured.onEvents!.legendselectchanged!({
      selected: { Land: false, Swamp: true, Offshore: true },
    });
    await waitFor(() => expect(series("Well spuds — Oil").data).toEqual([1]));
    const filteredTotal = series("total").data[0] as { label?: { formatter?: string } };
    expect(filteredTotal.label?.formatter).toBe("1");

    // The selection is threaded back so the visual toggle survives the rebuild.
    expect((captured.option as CapturedOption).legend.selected).toEqual({
      Land: false,
      Swamp: true,
      Offshore: true,
    });
  });

  it("toggling a spud line hides only that line — counts elsewhere unchanged", async () => {
    render(<CapacityChart title="T" data={DATA} />);
    captured.onEvents!.legendselectchanged!({
      selected: { "Well spuds — Oil": false },
    });
    await waitFor(() =>
      expect((captured.option as CapturedOption).legend.selected).toEqual({
        "Well spuds — Oil": false,
      }),
    );
    // Terrains all still selected → oil data stays the full count (echarts
    // hides the line; the values behind it are untouched).
    expect(series("Well spuds — Oil").data).toEqual([3]);
    const totalCell = series("total").data[0] as { label?: { formatter?: string } };
    expect(totalCell.label?.formatter).toBe("2");
  });
});
