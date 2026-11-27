"""The backend test suite.

This file runs before conftest.py and before any test module, so it is the one
place that is certain to run before the application is first imported.
"""

import os

# The suite must not depend on the developer's backend/.env. app.config builds
# and VALIDATES its settings the moment it is imported, and the database engine
# and the CORS setup capture them at import too — so a local PILOT_MODE there
# changes what the routes do, and a half-finished one stops the tests before
# they start. Switch the settings file off (app/config.py: DS_ENV_FILE) before
# the first import. The process environment still applies, so CI's DATABASE_URL
# keeps working.
os.environ["DS_ENV_FILE"] = ""
