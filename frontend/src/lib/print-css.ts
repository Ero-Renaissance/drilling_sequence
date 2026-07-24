/** Shared machinery for the print controls (revision + working-copy sequence).
 *
 *  Only ONE print document may be mounted at a time: every control dispatches
 *  this event with its own id when it claims the printer, and every OTHER
 *  control unmounts its document on hearing a foreign id.
 */
export const PRINT_CLAIM_EVENT = "ds-revision-print-claim";

/** The print stylesheet, mounted only while a control owns the print.
 *
 *  The exclusivity rule is structural: the document portals to <body> and this
 *  sheet hides every other body child (app root, Radix portals, toasts), so no
 *  host page can leak into the PDF — it cannot depend on pages sprinkling
 *  print:hidden on their own sections. `pageSize` is a CSS @page size value
 *  (e.g. "A4 landscape" or the readiness A4/A3/A2 mapping).
 */
export function printDocCss(pageSize: string): string {
  return `
    @media print {
      /* Exclusivity: everything except this document disappears —
         whatever page hosts the control, including portal'd menus. */
      body.ds-printing-revision > *:not(.ds-print-doc) { display: none !important; }
      .ds-print-doc { padding-bottom: 12mm; }
      @page { size: ${pageSize}; margin: 14mm 12mm; }
      /* Force light document tokens so a dark-mode user still gets a clean,
         readable PDF (dark text on white), not light text on white. */
      :root, .dark {
        --background: 0 0% 100%;
        --foreground: 222 24% 12%;
        --card: 0 0% 100%;
        --card-foreground: 222 24% 12%;
        --muted: 220 14% 95%;
        --muted-foreground: 220 9% 40%;
        --border: 220 13% 85%;
      }
      body { background: white !important; }
      aside, header, .print\\:hidden { display: none !important; }
      main { overflow: visible !important; }
      /* Unclip scroll containers + height caps so content paginates across
         pages and the chart legend (below the Gantt) isn't cut off. */
      .overflow-auto, .overflow-y-auto { overflow: visible !important; }
      .h-full, .h-screen { height: auto !important; }
      .shadow-soft-sm, .shadow-soft-md, .shadow-soft-lg { box-shadow: none !important; }
      /* Preserve brand colours (gradient linebar, status badges) in print. */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      /* Room for the fixed confidentiality footer. */
      main > div { padding-bottom: 12mm; }
      /* The schedule table: repeat the header on every page, keep rows whole,
         and give clean horizontal rules so it reads as a formal schedule. */
      thead { display: table-header-group; }
      tbody tr { break-inside: avoid; }
      th, td { border-bottom: 1px solid hsl(220 13% 88%) !important; }
      h2 { break-after: avoid; }
    }
  `;
}
