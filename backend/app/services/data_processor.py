"""
Data processing — CSV / Excel import helpers.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime

import pandas as pd

REQUIRED_COLUMNS = ["Activity Type", "Start Date", "End Date"]

# Maps CSV alias column names → DB field names (used at import time)
CSV_ALIASES: dict[str, str] = {
    # entity aliases
    "Item Name": "well_name",
    "Task Name": "well_name",
    "Name": "well_name",
    "Well Name": "well_name",
    # resource aliases
    "Resource": "rig_name",
    "Equipment": "rig_name",
    "Team": "rig_name",
    "Contractor": "rig_name",
    "Rig Name": "rig_name",
    "HWU Name": "hwu_name",
    "HWU": "hwu_name",
    "Hydraulic Workover Unit": "hwu_name",
    # group aliases
    "Group": "project_group",
    "Category": "project_group",
    "Project Name": "project_group",
    "Project": "project_group",
    # direct mappings
    "Activity Type": "activity_type",
    "Start Date": "start_date",
    "End Date": "end_date",
    "Location": "location",
    "Risk": "risk",
    "Comment": "comment",
    "Plan Type": "plan_type",
}


# Spreadsheet dates are read DAY-FIRST (DD/MM/YYYY or DD-MM-YYYY), the local
# convention. Real Excel date *cells* arrive as datetimes and pass through unchanged;
# only text dates are parsed. A non-blank cell that isn't a valid day-first date
# rejects the whole upload — we never silently misread a month-first date.
DATE_FORMAT_HINT = "DD/MM/YYYY or DD-MM-YYYY (e.g. 31/07/2026)"


def _parse_dates(values: pd.Series) -> pd.Series:
    """Parse a column of (already-validated) day-first / ISO dates; blanks → NaT.
    `format="mixed"` infers each cell's format (pandas' recommended pairing with
    `dayfirst`), which also silences the ISO-vs-dayfirst warning."""
    return pd.to_datetime(values, dayfirst=True, format="mixed", errors="coerce")


# Day-first DD/MM/YYYY or DD-MM-YYYY (1–2 digit day/month, 4-digit year); ISO too.
_DAYFIRST_RE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$")
_ISO_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")


def _is_blank(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return bool(pd.isna(value))


def _is_valid_date_cell(value: object) -> bool:
    """True if a cell is blank, a real date/datetime (an Excel date cell), or a
    day-first / ISO date string naming a real date. A month-first string like
    07/15/2026 (month 15) or an impossible date (31/02/2026) is rejected — pandas'
    dayfirst silently falls back to month-first, so we check day/month ourselves."""
    if _is_blank(value):
        return True  # a missing *required* date is caught later by the row schema
    if isinstance(value, (datetime, date)):
        return True  # real Excel date cell — already a date, display-format-agnostic
    s = str(value).strip()
    m = _DAYFIRST_RE.match(s)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        iso = _ISO_RE.match(s)
        if not iso:
            return False
        year, month, day = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
    try:
        date(year, month, day)  # rejects month > 12, day > 31, 31 Feb, …
    except ValueError:
        return False
    return True


def validate_date_columns(df: pd.DataFrame, columns: list[str]) -> None:
    """Reject the upload if any present date column has a cell that isn't a valid
    day-first (or ISO) date. Blank cells pass here (a missing *required* date is
    caught later by the row schema); the error names the column, the offending values
    and their row numbers so the user can fix the file and re-upload."""
    for col in columns:
        if col not in df.columns:
            continue
        bad_values: list[str] = []
        bad_rows: list[str] = []
        for idx, value in df[col].items():
            if not _is_valid_date_cell(value):
                bad_values.append(str(value).strip())
                bad_rows.append(str(int(idx) + 2))  # +2: header row + 1-based
        if bad_values:
            examples = list(dict.fromkeys(bad_values))[:5]
            raise ValueError(
                f"Couldn't read {len(bad_values)} date(s) in column '{col}'. "
                f"Dates must be {DATE_FORMAT_HINT}. "
                f"Problem value(s): {', '.join(repr(e) for e in examples)} "
                f"(row(s) {', '.join(bad_rows[:5])})."
            )


def validate_csv_columns(df: pd.DataFrame) -> None:
    """Raise ValueError if mandatory columns are missing or any date is malformed."""
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    validate_date_columns(df, ["Start Date", "End Date"])


_DATE_DB_FIELDS = {"start_date", "end_date"}


def csv_df_to_db_rows(df: pd.DataFrame, project_id: str) -> list[dict]:
    """
    Convert a validated CSV DataFrame into a list of dicts ready for bulk insert.
    Unknown columns are silently dropped.
    """
    # Parse date columns to Timestamp so we can extract .date() below
    date_csv_cols = {
        csv_col for csv_col, db_field in CSV_ALIASES.items()
        if db_field in _DATE_DB_FIELDS and csv_col in df.columns
    }
    df = df.copy()
    for col in date_csv_cols:
        df[col] = _parse_dates(df[col])

    rows = []
    for _, row in df.iterrows():
        record: dict = {"project_id": project_id}
        for csv_col, db_field in CSV_ALIASES.items():
            if csv_col in df.columns:
                val = row.get(csv_col)
                # pandas NaT / NaN → None
                if (not isinstance(val, str)) and pd.isna(val):
                    val = None
                elif db_field in _DATE_DB_FIELDS:
                    val = val.date()  # Timestamp → datetime.date for SQLAlchemy Date column
                elif hasattr(val, "item"):
                    val = val.item()  # numpy scalar → native Python (so Pydantic can validate)
                record.setdefault(db_field, val)
        rows.append(record)
    return rows


# ── Long-format schedule ingestion (the new upload) ──────────────────────────
#
# The schedule export is "long": one row per (well-activity × readiness gate), so a
# single well repeats once per gate. We collapse those rows back into one activity
# plus its readiness checks, and capture the per-rig contract-expiry date alongside.

# Presence of these columns marks a file as the long schedule format.
LONG_FORMAT_COLUMNS = ("Readiness Check", "Readiness Check Status")

LONG_REQUIRED_COLUMNS = ["Activity Type", "Start Date", "End Date", "Well Name", "Readiness Check"]

# Spreadsheet plan-type wording → canonical PlanType (app/schemas/activity.py).
PLAN_TYPE_MAP = {
    "in plan (firm)": "Firm",
    "in plan (option)": "Option",
    "out of plan": "Out of Plan",
    "firm": "Firm",
    "option": "Option",
}

# Spreadsheet readiness wording → canonical CheckStatus (app/models/readiness.py).
# The status model collapsed to On Track / Completed / Behind / N/A, so the
# upload's "not started" / "in progress" wording all fold into "On Track".
READINESS_STATUS_MAP = {
    "on track": "On Track",
    "completed": "Completed",
    "not started": "On Track",
    "in progress": "On Track",
    "behind": "Behind",
    "n/a": "N/A",
}


def is_long_schedule(df: pd.DataFrame) -> bool:
    """True when the upload is the long (one-row-per-readiness-gate) schedule format."""
    return all(c in df.columns for c in LONG_FORMAT_COLUMNS)


def _clean(value: object) -> str | None:
    """Trim to a non-empty string, or None (treats NaN / blank as None)."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def _to_date(value: object) -> date | None:
    """Parse a cell to a date. Handles real datetimes and day-first strings like
    31/07/2026; blank/unparseable → None. Malformed dates are caught up front by
    validate_date_columns, so here None means a genuinely empty cell."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return None
    ts = pd.to_datetime(value, dayfirst=True, errors="coerce")
    return None if pd.isna(ts) else ts.date()


def _map_plan_type(value: object) -> str | None:
    text = _clean(value)
    if text is None:
        return None
    return PLAN_TYPE_MAP.get(text.lower(), text)  # unknown → passthrough (schema validates)


def _map_readiness_status(value: object) -> str:
    text = _clean(value)
    if text is None:
        return "On Track"
    return READINESS_STATUS_MAP.get(text.lower(), text)  # unknown → passthrough (caller validates)


@dataclass
class ParsedActivity:
    """One collapsed well-activity plus its readiness gate→status map."""

    fields: dict  # ActivityCreate-shaped (includes `project`)
    readiness: dict = field(default_factory=dict)


def parse_long_schedule(
    df: pd.DataFrame,
) -> tuple[list[ParsedActivity], dict[str, date], dict[str, date]]:
    """Collapse the long schedule into (activities, rig_contracts, hwu_contracts).

    Rows are grouped by their well-activity identity; each row contributes one
    readiness gate to its activity. A row uses a rig OR an HWU, and the matching
    contract-expiry date is captured per resource — rigs keyed by "Rig Name"
    (from "Rig Contract Expiry Date"), HWUs by "HWU Name" (from "HWU Contract
    Expiry Date") — so both rig and HWU contracts ingest from one sheet.
    """
    missing = [c for c in LONG_REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    validate_date_columns(
        df, ["Start Date", "End Date", "Rig Contract Expiry Date", "HWU Contract Expiry Date"]
    )

    activities: dict[tuple, ParsedActivity] = {}
    rig_contracts: dict[str, date] = {}
    hwu_contracts: dict[str, date] = {}

    for _, row in df.iterrows():
        well = _clean(row.get("Well Name"))
        rig = _clean(row.get("Rig Name"))
        hwu = _clean(row.get("HWU Name"))
        activity_type = _clean(row.get("Activity Type"))
        start = _to_date(row.get("Start Date"))
        end = _to_date(row.get("End Date"))
        project = _clean(row.get("Project"))

        key = (project, well, rig, hwu, activity_type, start, end)
        rec = activities.get(key)
        if rec is None:
            rec = ParsedActivity(
                fields={
                    "activity_type": activity_type,
                    "start_date": start,
                    "end_date": end,
                    "well_name": well,
                    "rig_name": rig,
                    "hwu_name": hwu,
                    "well_project": project,
                    "location": _clean(row.get("Location")),
                    "plan_type": _map_plan_type(row.get("Plan Type")),
                    "risk": _clean(row.get("Risk")),
                    "comment": _clean(row.get("Comment")),
                }
            )
            activities[key] = rec

        gate = _clean(row.get("Readiness Check"))
        if gate:
            rec.readiness[gate.upper()] = _map_readiness_status(row.get("Readiness Check Status"))

        rig_expiry = _to_date(row.get("Rig Contract Expiry Date"))
        if rig and rig_expiry:
            rig_contracts[rig] = rig_expiry
        hwu_expiry = _to_date(row.get("HWU Contract Expiry Date"))
        if hwu and hwu_expiry:
            hwu_contracts[hwu] = hwu_expiry

    return list(activities.values()), rig_contracts, hwu_contracts


