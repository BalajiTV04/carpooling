# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app/backend

# System dependencies (minimal — no build tools needed for pure-python wheels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy application code (app package lives at /app/backend/app/)
COPY backend/ ./

# Copy ML artifacts (ranked JSON weights read at runtime)
COPY ml/artifacts/ ./ml/artifacts/

# Copy database schemas (used by init_db and db_admin)
COPY database/ ./database/

# Expose the port Render injects via $PORT
ENV PORT=8000
EXPOSE 8000

# Production startup — single worker because the WebSocket hub is in-process.
# Render provides $PORT; do not hardcode it.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1