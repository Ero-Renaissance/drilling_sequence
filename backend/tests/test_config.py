"""Fail-closed configuration guards for production deployments."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.config import Settings

# _env_file=None isolates these from the local .env (which sets DEV_MODE=true).
_PROXY = {"proxy_user_header": "X-Remote-User"}


def test_production_rejects_dev_mode() -> None:
    with pytest.raises(ValueError, match="DEV_MODE"):
        Settings(_env_file=None, environment="production", dev_mode=True, **_PROXY)


def test_production_requires_proxy_user_header() -> None:
    with pytest.raises(ValueError, match="PROXY_USER_HEADER"):
        Settings(_env_file=None, environment="production", dev_mode=False)


def test_production_boots_when_configured() -> None:
    s = Settings(_env_file=None, environment="production", dev_mode=False, **_PROXY)
    assert s.is_production is True
    assert s.dev_mode is False


def test_development_allows_dev_mode() -> None:
    s = Settings(_env_file=None, environment="development", dev_mode=True)
    assert s.is_production is False
    assert s.dev_mode is True


# --- Pilot sign-in: all-or-nothing, in every environment ----------------------

_PILOT = {
    "pilot_mode": True,
    "pilot_passcode": "drill-pilot-passcode",
    "pilot_session_secret": "s" * 40,
    "user_email_domain": "renaissanceafrica.com",
}


def _pilot(**changes) -> dict:
    return {**_PILOT, **changes}


def test_production_boots_on_a_complete_pilot_without_the_proxy_header() -> None:
    s = Settings(_env_file=None, environment="production", dev_mode=False, **_PILOT)
    assert s.sign_in_mode == "pilot"
    assert s.approvals_enabled is False
    assert s.pilot_session_days == 30


def test_approvals_stay_on_outside_pilot() -> None:
    s = Settings(_env_file=None, environment="production", dev_mode=False, **_PROXY)
    assert s.sign_in_mode == "sso"
    assert s.approvals_enabled is True


def test_production_without_proxy_header_or_pilot_still_refuses() -> None:
    with pytest.raises(ValueError, match="PROXY_USER_HEADER"):
        Settings(_env_file=None, environment="production", dev_mode=False, pilot_mode=False)


@pytest.mark.parametrize("environment", ["production", "development"])
@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"dev_mode": True}, "DEV_MODE"),
        ({"proxy_user_header": "X-Remote-User"}, "PROXY_USER_HEADER"),
        ({"pilot_passcode": ""}, "PILOT_PASSCODE"),
        ({"pilot_passcode": "short"}, "PILOT_PASSCODE"),
        ({"pilot_session_secret": ""}, "PILOT_SESSION_SECRET"),
        ({"pilot_session_secret": "s" * 31}, "PILOT_SESSION_SECRET"),
        ({"pilot_passcode": "s" * 40}, "must differ"),
        ({"user_email_domain": "  "}, "USER_EMAIL_DOMAIN"),
        ({"pilot_session_days": 0}, "PILOT_SESSION_DAYS"),
        ({"pilot_session_days": 91}, "PILOT_SESSION_DAYS"),
    ],
)
def test_half_configured_pilot_refuses_to_start(environment, changes, message) -> None:
    with pytest.raises(ValueError, match=message):
        Settings(_env_file=None, environment=environment, **_pilot(**changes))



# --- DS_ENV_FILE: which settings file is read -----------------------------------
# Decided when app.config is first imported, so each case runs in a fresh
# interpreter, from an empty folder (no .env of its own to be picked up).

_BACKEND = Path(__file__).resolve().parents[1]
_PROBE = "from app.config import Settings, settings; print(Settings.model_config.get('env_file'), settings.pilot_mode)"


def _probe(tmp_path: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    clean = {k: v for k, v in os.environ.items() if k != "DS_ENV_FILE" and not k.startswith("PILOT_")}
    return subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=tmp_path,
        env={**clean, "PYTHONPATH": str(_BACKEND), **env},
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_settings_file_defaults_to_dot_env(tmp_path: Path) -> None:
    result = _probe(tmp_path, {})
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == [".env", "False"]


def test_settings_file_can_be_switched_off(tmp_path: Path) -> None:
    # A half-finished pilot setup in the local file would stop the app starting…
    (tmp_path / ".env").write_text("PILOT_MODE=true\n")
    assert _probe(tmp_path, {}).returncode != 0
    # …but not when the file is switched off, as the test suite does.
    result = _probe(tmp_path, {"DS_ENV_FILE": ""})
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["None", "False"]


def test_settings_file_can_be_another_file_and_is_still_guarded(tmp_path: Path) -> None:
    (tmp_path / "other.env").write_text("PILOT_MODE=true\n")
    # The guard checks whatever was loaded, wherever it came from.
    result = _probe(tmp_path, {"DS_ENV_FILE": "other.env"})
    assert result.returncode != 0
    assert "PILOT_PASSCODE" in result.stderr


def test_the_environment_still_overrides_with_the_file_switched_off(tmp_path: Path) -> None:
    result = _probe(
        tmp_path,
        {
            "DS_ENV_FILE": "",
            "PILOT_MODE": "true",
            "PILOT_PASSCODE": "a-long-enough-passcode",
            "PILOT_SESSION_SECRET": "s" * 40,
            "USER_EMAIL_DOMAIN": "example.test",
        },
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["None", "True"]
