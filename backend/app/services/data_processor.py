"""
Data processing — CSV import helpers.
"""

import pandas as pd

REQUIRED_COLUMNS = ["Activity Type", "Start Date", "End Date"]

# Maps CSV alias column names → DB field names (used at import time)
CSV_ALIASES: dict[str, str] = {
    # entity aliases
    "Item Name": "well_name",
    "Task Name": "well_name",
    "Project Name": "well_name",
    "Name": "well_name",
    "Well Name": "well_name",
    # resource aliases
    "Resource": "rig_name",
    "Equipment": "rig_name",
    "Team": "rig_name",
    "Contractor": "rig_name",
    "Rig Name": "rig_name",
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
    "Readiness Check": "readiness_check",
    "Readiness Check Status": "readiness_check_status",
    "Risk": "risk",
    "Comment": "comment",
    "Plan Type": "plan_type",
    "Rig Contract Expiry Date": "rig_contract_expiry_date",
    "Rig Contract Days Remaining": "rig_contract_days_remaining",
}


def validate_csv_columns(df: pd.DataFrame) -> None:
    """Raise ValueError if mandatory columns are missing from a CSV upload."""
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    for col in ["Start Date", "End Date"]:
        try:
            pd.to_datetime(df[col])
        except Exception as exc:
            raise ValueError(f"Invalid date format in '{col}': {exc}") from exc


_DATE_DB_FIELDS = {"start_date", "end_date", "rig_contract_expiry_date"}


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
        df[col] = pd.to_datetime(df[col], errors="coerce")

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


