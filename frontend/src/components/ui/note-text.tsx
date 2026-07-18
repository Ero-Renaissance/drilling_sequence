import { Fragment } from "react";

import { parseNoteMarkup } from "@/lib/note-markup";
import { cn } from "@/lib/utils";

/**
 * Renders a note body with the lists subset (bullet / numbered lines) as real
 * lists, built entirely from React elements — never innerHTML.
 */
export function NoteText({ body, className }: { body: string; className?: string }) {
  const blocks = parseNoteMarkup(body);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("space-y-1", className)}>
      {blocks.map((block, i) => (
        <Fragment key={i}>
          {block.type === "text" ? (
            <p className="whitespace-pre-wrap">{block.text}</p>
          ) : block.type === "bullets" ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          ) : (
            <ol className="list-decimal space-y-0.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          )}
        </Fragment>
      ))}
    </div>
  );
}
