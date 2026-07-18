import { describe, expect, it } from "vitest";

import { applyLinePrefix, parseNoteMarkup } from "@/lib/note-markup";

describe("parseNoteMarkup", () => {
  it("groups consecutive '- ' lines into one bullet list", () => {
    expect(parseNoteMarkup("- one\n- two\nplain tail")).toEqual([
      { type: "bullets", items: ["one", "two"] },
      { type: "text", text: "plain tail" },
    ]);
  });

  it("recognises numbered lines with '.' or ')'", () => {
    expect(parseNoteMarkup("1. first\n2) second")).toEqual([
      { type: "numbers", items: ["first", "second"] },
    ]);
  });

  it("keeps plain text as text, splitting bullet runs", () => {
    expect(parseNoteMarkup("- a\nbetween\n- b")).toEqual([
      { type: "bullets", items: ["a"] },
      { type: "text", text: "between" },
      { type: "bullets", items: ["b"] },
    ]);
  });

  it("empty and whitespace bodies yield nothing", () => {
    expect(parseNoteMarkup("")).toEqual([]);
    expect(parseNoteMarkup("  \n ")).toEqual([]);
  });
});

describe("applyLinePrefix", () => {
  it("prefixes every selected line and numbers sequentially", () => {
    const v = "alpha\nbeta\ngamma";
    const out = applyLinePrefix(v, 0, v.length, "numbers");
    expect(out.value).toBe("1. alpha\n2. beta\n3. gamma");
  });

  it("toggles off when every touched line already has the style", () => {
    const v = "- alpha\n- beta";
    const out = applyLinePrefix(v, 0, v.length, "bullets");
    expect(out.value).toBe("alpha\nbeta");
  });

  it("converts between styles instead of stacking prefixes", () => {
    const v = "1. alpha\n2. beta";
    const out = applyLinePrefix(v, 0, v.length, "bullets");
    expect(out.value).toBe("- alpha\n- beta");
  });

  it("expands a caret selection to whole lines", () => {
    const v = "alpha\nbeta";
    const caret = v.indexOf("beta") + 2;
    const out = applyLinePrefix(v, caret, caret, "bullets");
    expect(out.value).toBe("alpha\n- beta");
  });
});
