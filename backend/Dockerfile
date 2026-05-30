FROM python:3.11-slim

WORKDIR /app

RUN pip install uv

# Install the locked, fully-pinned dependency set (reproducible builds for IT
# review). The app package itself isn't pip-installed — it runs from WORKDIR.
COPY pyproject.toml requirements.txt ./
RUN uv pip install --system -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
