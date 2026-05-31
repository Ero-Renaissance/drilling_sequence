FROM python:3.11-slim

WORKDIR /app

# Microsoft ODBC Driver 18 + unixODBC — required at runtime by pyodbc/aioodbc to
# reach MSSQL. This is the one genuinely new OS-level dependency of the Postgres
# -> MSSQL move (flagged for IT review). The base image is Debian 12 (bookworm);
# adjust the distro path if the base changes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg unixodbc-dev \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
 && apt-get purge -y curl gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

RUN pip install uv

# Install the locked, fully-pinned dependency set (reproducible builds for IT
# review). The app package itself isn't pip-installed — it runs from WORKDIR.
COPY pyproject.toml requirements.txt ./
RUN uv pip install --system -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
