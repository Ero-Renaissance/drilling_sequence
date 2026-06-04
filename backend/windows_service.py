r"""Windows Service wrapper for the Drilling Sequence backend (uvicorn).

Runs uvicorn as a proper Windows service via **pywin32** — a pip package, so it
needs no third-party service installer (NSSM / WinSW / HttpPlatformHandler). Use
it for a single-origin deploy where uvicorn also serves the built frontend
(set STATIC_DIR in backend\.env) and terminates TLS itself.

This file is Windows-only deploy scaffolding: it is never imported by the app or
the test suite, and it imports pywin32 only when executed.

Prerequisites on the host (run from backend\):
    py -3.11 -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt
    .venv\Scripts\python -m pip install pywin32

Install / manage (run in an *elevated* shell, using the venv's python so pywin32
resolves):
    .venv\Scripts\python windows_service.py install
    .venv\Scripts\python windows_service.py start
    .venv\Scripts\python windows_service.py stop
    .venv\Scripts\python windows_service.py remove

Auto-start + restart-on-failure (configure once, after install):
    sc.exe config DrillingSequence start= auto
    sc.exe failure DrillingSequence reset= 86400 actions= restart/5000/restart/5000/restart/5000

Run-time configuration (environment variables the service inherits — set them
machine-wide or in the service account's profile). The app's own settings
(DATABASE_URL, Azure IDs, STATIC_DIR, …) come from backend\.env as usual:
    DS_HOST            default 0.0.0.0
    DS_PORT            default 443
    DS_SSL_CERTFILE    PEM certificate chain  (omit BOTH for plain HTTP — testing only)
    DS_SSL_KEYFILE     PEM private key
    DS_UVICORN_WORKERS default 1
"""
import os
import subprocess
import sys

import servicemanager
import win32event
import win32service
import win32serviceutil

HERE = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.path.join(HERE, ".venv", "Scripts", "python.exe")


def _uvicorn_command() -> list[str]:
    cmd = [
        VENV_PYTHON,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        os.environ.get("DS_HOST", "0.0.0.0"),
        "--port",
        os.environ.get("DS_PORT", "443"),
        "--workers",
        os.environ.get("DS_UVICORN_WORKERS", "1"),
    ]
    cert = os.environ.get("DS_SSL_CERTFILE")
    key = os.environ.get("DS_SSL_KEYFILE")
    if cert and key:
        cmd += ["--ssl-certfile", cert, "--ssl-keyfile", key]
    return cmd


class DrillingSequenceService(win32serviceutil.ServiceFramework):
    _svc_name_ = "DrillingSequence"
    _svc_display_name_ = "Renaissance Drilling Sequence (backend)"
    _svc_description_ = (
        "Serves the Drilling Sequence app (FastAPI/uvicorn) and the built frontend."
    )

    def __init__(self, args: list[str]) -> None:
        super().__init__(args)
        self._proc: subprocess.Popen | None = None
        self._stop = win32event.CreateEvent(None, 0, 0, None)

    def SvcStop(self) -> None:
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        win32event.SetEvent(self._stop)

    def SvcDoRun(self) -> None:
        servicemanager.LogInfoMsg(f"{self._svc_name_}: starting uvicorn")
        self._proc = subprocess.Popen(_uvicorn_command(), cwd=HERE)
        # Block until SvcStop signals. If uvicorn dies on its own, exit non-zero so
        # the SCM's restart-on-failure recovery action takes over.
        while True:
            if win32event.WaitForSingleObject(self._stop, 5000) == win32event.WAIT_OBJECT_0:
                break
            if self._proc.poll() is not None:
                servicemanager.LogErrorMsg(
                    f"{self._svc_name_}: uvicorn exited with code {self._proc.returncode}"
                )
                os._exit(self._proc.returncode or 1)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        # Invoked by the Windows SCM (no CLI args) — hand control to the dispatcher.
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(DrillingSequenceService)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        # install / start / stop / remove from the command line.
        win32serviceutil.HandleCommandLine(DrillingSequenceService)
