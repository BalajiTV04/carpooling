# Module 25 — production image. The dev Dockerfile behaviour (live reload,
# source mounted) is deliberately NOT what ships here.
#
# Three stages so the runtime image never carries a compiler:
#   base    -> python + workdir
#   builder -> wheels built once
#   runtime -> installs the wheels, runs as a non-root user
#
# GIT_SHA is a build ARG so /api/v1/version can identify the exact build.
# NOTE: single worker on purpose. Module 20's WebSocket hub (services/hub.py)
# is an IN-PROCESS registry, so a second worker would serve its own watchers
# and half the clients would silently miss frames. Scale-out needs a shared
# bus (Redis pub/sub or NATS) behind hub.broadcast(); no caller changes.
FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /code

FROM base AS builder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM base AS runtime
RUN groupadd -r app && useradd -r -g app app
COPY --from=builder /wheels /wheels
RUN pip install --no-index /wheels/*.whl && rm -rf /wheels
COPY --chown=app:app . .
USER app

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA \
    APP_ENV=production

EXPOSE 8000
# Readiness, not liveness: an instance with no database cannot serve.
HEALTHCHECK --interval=30s --timeout=3s --start-period=25s --retries=3 \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/ready', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
