import { useState, type FormEvent } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconPicker, filterIconGroups, groupIconKeys } from "@/components/admin/IconPicker";
import { ICON_GROUPS, ICON_KEYS } from "@/components/readiness/icon-registry";

function Harness({ keys = [...ICON_KEYS], initial = "land-plot" }: { keys?: string[]; initial?: string }) {
  const [value, setValue] = useState(initial);
  return <IconPicker keys={keys} value={value} onChange={setValue} />;
}

const radios = () => screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"));
const search = () => screen.getByRole("searchbox", { name: "Search icons" });

describe("icon picker groups", () => {
  it("puts every registry key in exactly one group", () => {
    const grouped = ICON_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...ICON_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const g of ICON_GROUPS) expect(g.keys.length).toBeGreaterThan(0);
  });

  it("offers the spec's groups (§8.5), in order", () => {
    expect(ICON_GROUPS.map((g) => g.label)).toEqual([
      "Sites and planning",
      "Rigs and engineering",
      "Marine",
      "Aviation",
      "Land transport",
      "Lifting",
      "Permits and safety",
      "Documents and finance",
      "People and community",
      "Environment",
      "Comms",
    ]);
    const group = (label: string) => ICON_GROUPS.find((g) => g.label === label)?.keys;
    // The phase 7 seed icons (§3.4) sit where an admin would look for them.
    expect(group("Aviation")).toContain("helicopter");
    expect(group("Marine")).toEqual(expect.arrayContaining(["anchor", "container"]));
    expect(group("Land transport")).toContain("bus");
    expect(group("Lifting")).toContain("construction");
    expect(group("Permits and safety")).toContain("radiation");
  });

  it("shows only the keys the server offers, and a key it doesn't group under Other", () => {
    expect(groupIconKeys(["banknote", "map-pin", "newer-key"])).toEqual([
      { label: "Sites and planning", keys: ["map-pin"] },
      { label: "Documents and finance", keys: ["banknote"] },
      { label: "Other", keys: ["newer-key"] },
    ]);
  });

  it("searches icon names and group names", () => {
    const groups = groupIconKeys([...ICON_KEYS]);
    expect(filterIconGroups(groups, "ship")).toEqual([
      { label: "Marine", keys: ["ship", "ship-wheel"] },
    ]);
    expect(filterIconGroups(groups, "  Land Transport ")[0].keys).toContain("truck");
    expect(filterIconGroups(groups, "bus front")).toEqual([
      { label: "Land transport", keys: ["bus-front"] },
    ]);
    expect(filterIconGroups(groups, "")).toEqual(groups);
    expect(filterIconGroups(groups, "zzz")).toEqual([]);
  });
});

describe("IconPicker", () => {
  it("lists all 68 icons under group headings", () => {
    render(<Harness />);
    expect(radios()).toHaveLength(68);
    const marine = screen.getByRole("group", { name: "Marine" });
    expect(within(marine).getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: "land-plot" })).toHaveAttribute("aria-checked", "true");
  });

  it("narrows to a search, keeps the hidden choice, and picks from the results", () => {
    render(<Harness initial="banknote" />);
    fireEvent.change(search(), { target: { value: "heli" } });
    expect(radios()).toEqual(["helicopter"]);
    // The choice the search hides is still the choice, and still named.
    expect(screen.getByTestId("icon-picker-selected")).toHaveTextContent("banknote");

    fireEvent.click(screen.getByRole("radio", { name: "helicopter" }));
    expect(screen.getByRole("radio", { name: "helicopter" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("icon-picker-selected")).toHaveTextContent("helicopter");

    fireEvent.change(search(), { target: { value: "" } });
    expect(radios()).toHaveLength(68);
  });

  it("says so when nothing matches", () => {
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "no such icon" } });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("No icons match this search.")).toBeInTheDocument();
  });

  it("doesn't submit the surrounding form when Enter is pressed in the search", () => {
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness />
        <button type="submit">Save</button>
      </form>,
    );
    fireEvent.change(search(), { target: { value: "anchor" } });
    const enter = fireEvent.keyDown(search(), { key: "Enter" });
    expect(enter).toBe(false); // default prevented: no implicit submit
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
