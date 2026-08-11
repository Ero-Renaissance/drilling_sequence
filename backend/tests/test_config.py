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
