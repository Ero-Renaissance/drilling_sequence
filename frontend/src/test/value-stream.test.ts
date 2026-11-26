import { describe, expect, it } from "vitest";
import {
  NO_VALUE_STREAM,
  byValueStream,
  hasValueStreams,
  valueStreamOf,
  valueStreamsOf,
} from "@/lib/value-stream";

describe("value streams (the wells' Market)", () => {
  it("names a well's stream, and groups the ones with none", () => {
    expect(valueStreamOf("Oil")).toBe("Oil");
    expect(valueStreamOf("  Domestic Gas ")).toBe("Domestic Gas");
    for (const none of [null, undefined, "", "   "]) expect(valueStreamOf(none)).toBe(NO_VALUE_STREAM);
    expect(NO_VALUE_STREAM).toBe("No value stream");
  });

  it("lists distinct streams by name, the wells with none last", () => {
    expect(valueStreamsOf(["Oil", null, "Domestic Gas", "Oil", " ", "Export Gas"])).toEqual([
      "Domestic Gas",
      "Export Gas",
      "Oil",
      NO_VALUE_STREAM,
    ]);
    expect(["Oil", NO_VALUE_STREAM, "Gas"].sort(byValueStream)).toEqual(["Gas", "Oil", NO_VALUE_STREAM]);
    expect(valueStreamsOf([])).toEqual([]);
  });

  it("a filter is worth offering once any well names a stream", () => {
    expect(hasValueStreams([null, "", "  ", undefined])).toBe(false);
    expect(hasValueStreams([])).toBe(false);
    // One named stream beside wells with none is still a choice.
    expect(hasValueStreams([null, "Oil"])).toBe(true);
    expect(hasValueStreams(["Oil", "Oil"])).toBe(true);
  });
});
