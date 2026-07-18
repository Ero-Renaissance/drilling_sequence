/**
 * The notes formatting subset: BULLET ("- ") and NUMBERED ("1. " / "1) ")
 * lines, nothing else — it formalises how planners already type notes. The
 * parser is line-based and emits a plain block structure that NoteText turns
 * into React elements; no string is ever interpreted as HTML, so there is
 * nothing to sanitise.
 */

export type NoteBlock =
  | { type: "bullets"; items: string[] }
  | { type: "numbers"; items: string[] }
  | { type: "text"; text: string };

const BULLET = /^\s*-\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Parse a note body into blocks: consecutive list lines group into one list;
 *  everything else stays as text blocks split on blank lines. */
export function parseNoteMarkup(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let textRun: string[] = [];

  const flushText = () => {
    const text = textRun.join("\n").trim();
    if (text) blocks.push({ type: "text", text });
    textRun = [];
  };

  for (const line of body.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushText();
      const type = bullet ? "bullets" : "numbers";
      const item = (bullet ?? numbered)![1].trim();
      const last = blocks[blocks.length - 1];
      if (last && last.type === type) last.items.push(item);
      else blocks.push({ type, items: [item] } as NoteBlock);
    } else {
      textRun.push(line);
    }
  }
  flushText();
  return blocks;
}

/**
 * Toggle a list prefix on every line the selection touches — the toolbar's
 * behaviour, pure so it is unit-testable. Returns the new value plus the
 * range covering the rewritten lines (for restoring the selection).
 * If EVERY touched line already carries the requested style, it is removed.
 */
export function applyLinePrefix(
  value: string,
  selStart: number,
  selEnd: number,
  kind: "bullets" | "numbers",
): { value: string; selStart: number; selEnd: number } {
  const lineStart = value.lastIndexOf("\n", Math.max(0, selStart - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", selEnd);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;

  const before = value.slice(0, lineStart);
  const after = value.slice(lineEnd);
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const matcher = kind === "bullets" ? BULLET : NUMBERED;
  const allStyled = lines.every((l) => l.trim() === "" || matcher.test(l));

  const rewritten = lines.map((line, i) => {
    if (line.trim() === "") return line;
    const stripped = line.replace(BULLET, "$1").replace(NUMBERED, "$1");
    if (allStyled) return stripped;
    return kind === "bullets" ? `- ${stripped}` : `${i + 1}. ${stripped}`;
  });

  const middle = rewritten.join("\n");
  return {
    value: before + middle + after,
    selStart: lineStart,
    selEnd: lineStart + middle.length,
  };
}
