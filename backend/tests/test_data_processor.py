"""Unit tests for the importer's day-first date handling (app/services/data_processor)."""
import pandas as pd
import pytest

from app.services.data_processor import csv_df_to_db_rows, validate_date_columns


def test_validate_accepts_dayfirst_dash_and_iso() -> None:
    df = pd.DataFrame(
        {
            "Start Date": ["31/07/2026", "01-02-2026", "2026-03-15"],
            "End Date": ["31/07/2026", "01-02-2026", "2026-03-15"],
        }
    )
    validate_date_columns(df, ["Start Date", "End Date"])  # no raise


def test_validate_rejects_month_first() -> None:
    df = pd.DataFrame({"Start Date": ["07/15/2026"]})  # month 15 — not valid day-first
    with pytest.raises(ValueError) as exc:
        validate_date_columns(df, ["Start Date"])
    msg = str(exc.value)
    assert "Start Date" in msg and "DD/MM/YYYY" in msg


def test_validate_ignores_blank_cells() -> None:
    df = pd.DataFrame({"Start Date": ["31/07/2026", None, ""]})
    validate_date_columns(df, ["Start Date"])  # blanks are not a format error


def test_validate_skips_absent_columns() -> None:
    validate_date_columns(pd.DataFrame({"X": [1]}), ["Start Date"])  # no raise


def test_csv_rows_parse_dates_day_first() -> None:
    df = pd.DataFrame(
        {"Activity Type": ["Oil"], "Start Date": ["05/01/2026"], "End Date": ["31/03/2026"]}
    )
    rows = csv_df_to_db_rows(df, "pid")
    assert str(rows[0]["start_date"]) == "2026-01-05"  # 05/01 → 5 Jan
    assert str(rows[0]["end_date"]) == "2026-03-31"
