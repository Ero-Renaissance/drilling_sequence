"""Fail-closed configuration guards for production deployments."""
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
