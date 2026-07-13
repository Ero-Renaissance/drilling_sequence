"""The activity-type vocabulary: the canonical catalogue and how a written
value resolves onto it.

Pandas-free on purpose — this is the domain vocabulary, imported by both the
schema layer (a validator normalizes every write) and the CSV/Excel importer
(data_processor re-exports these). Keeping it out of data_processor avoids
dragging pandas into the schema import chain.

Resolution layers (see resolve_activity_type):
  canonical → formatting (silent) → remembered alias → this upload's manual
  mapping → unknown (kept verbatim, warned).
Never fuzzy: a genuine typo is never auto-corrected — a human maps it.
"""
import re

# Canonical activity-type catalogue — MUST stay in sync with the color map in
# frontend/src/lib/chart-colors.ts (the chart renders any type outside this set
# in a neutral "colour pending" grey). Activity type stays a free-form string in
# the schema — an unknown type is imported fine and only WARNED about, so a new
# vocabulary entry is visible, never blocked.
CANONICAL_ACTIVITY_TYPES = frozenset(
    {
        "Oil Development",
        "Oil Appraisal",
        "Oil Workover",
        "Oil Exploration",
        "Gas Development",
        "Gas Appraisal",
        "Gas Workover",
        "Gas Exploration (including HPHT)",
        "Gas Appraisal (including HPHT)",
        "HPHT (Development)",
        "Water Injection",
        "Well Repair/Safety",
        "Rig Mobilisation and Intake",
        "Well Cleanup/Test",
        "Abandonment",
    }
)

# Pre-compiled once — normalize runs per row on every import and every write.
_PAREN_OPEN = re.compile(r"\s*\(\s*")
_PAREN_CLOSE = re.compile(r"\s*\)")
_WHITESPACE = re.compile(r"\s+")


def normalize_activity_type_key(value: str) -> str:
    """Formatting-insensitive lookup key for an activity type: case-folded,
    whitespace collapsed, parenthesis spacing normalised — so
    "Gas Exploration(Including HPHT)" and "Gas Exploration (including HPHT)"
    share a key. Formatting-level matches resolve silently; they are the same
    words, differently typed."""
    key = value.strip().lower()
    key = _PAREN_OPEN.sub(" (", key)
    key = _PAREN_CLOSE.sub(")", key)
    return _WHITESPACE.sub(" ", key)


_CANONICAL_BY_KEY = {normalize_activity_type_key(t): t for t in CANONICAL_ACTIVITY_TYPES}


def resolve_activity_type(
    raw: str | None,
    extra_aliases: "dict[str, str] | None" = None,
    user_mappings: "dict[str, str] | None" = None,
) -> "tuple[str | None, str]":
    """Resolve a written activity type against the canonical catalogue.

    Returns (stored_value, how):
      canonical  — exact catalogue entry, stored as-is
      formatting — same words modulo case/whitespace/parenthesis → canonical
                   spelling (silent: nothing semantically changed)
      alias      — a remembered synonym (activity_type_aliases) → its canonical
      mapped     — resolved by THIS upload's manual mapping step
      unknown    — none of the above; stored verbatim and warned about
    Alias/mapped rewrites are word-level changes and must be reported in the
    import summary — the record never rewrites a sheet silently.
    """
    if raw is None or not raw.strip():
        return raw, "unknown"
    value = raw.strip()
    if value in CANONICAL_ACTIVITY_TYPES:
        return value, "canonical"
    key = normalize_activity_type_key(value)
    canonical = _CANONICAL_BY_KEY.get(key)
    if canonical:
        return canonical, "formatting"
    target = (extra_aliases or {}).get(key)
    if target:
        return target, "alias"
    mapped = (user_mappings or {}).get(key)
    if mapped:
        return mapped, "mapped"
    return value, "unknown"


def canonicalize_activity_type(value: str | None) -> str | None:
    """The formatting-only normalization applied to EVERY activity write (import,
    manual create, manual edit) via the schema validator, so "gas development" or
    "Gas Exploration(Including HPHT)" store their canonical spelling no matter the
    entry path. Aliases/manual-mappings are import-only and NOT applied here — a
    plain None/empty or an unknown type passes through verbatim (charts grey)."""
    if not value or not value.strip():
        return value
    resolved, _how = resolve_activity_type(value)  # canonical / formatting / unknown
    return resolved


def unknown_activity_type_warnings(activity_types: "list[str | None]") -> list[str]:
    """One warning per distinct activity type outside the canonical catalogue.
    The import still accepts the rows — the warning tells the planner the type
    will render in neutral grey until it's added to the catalogue."""
    unknown = sorted({t for t in activity_types if t and t not in CANONICAL_ACTIVITY_TYPES})
    return [
        f"Activity type '{t}' is not in the canonical catalogue — it will chart "
        f"in neutral grey until an admin adds it."
        for t in unknown
    ]
