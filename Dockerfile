# The weekly pipeline job: fetch, archive, parse, build, check, deploy, D1 sync (pipeline/weekly.sh).
# Built and run on the maintainer's home server every week; see NOTES.md, "Weekly job".
#   docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t nl-ledger-pipeline .
#   docker run --rm --env-file .env -v "$PWD/data:/app/data" nl-ledger-pipeline
FROM node:24-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 poppler-utils tesseract-ocr tesseract-ocr-eng curl jq ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv

ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy UV_FROZEN=1 UV_NO_SYNC=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv UV_CACHE_DIR=/tmp/uv-cache \
    NPM_CONFIG_UPDATE_NOTIFIER=false ASTRO_TELEMETRY_DISABLED=1 HOME=/home/node
WORKDIR /app

# Dependencies first, so a code-only change rebuilds in seconds.
COPY pipeline/pyproject.toml pipeline/uv.lock pipeline/
RUN cd pipeline && uv sync --no-install-project && rm -rf /tmp/uv-cache
COPY site/package.json site/package-lock.json site/
RUN cd site && npm ci --no-audit --no-fund && npm cache clean --force

COPY . .
RUN mkdir -p data && chown -R node:node /app /opt/venv
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA \
    PATH=/app/site/node_modules/.bin:$PATH
USER node
VOLUME /app/data
CMD ["pipeline/weekly.sh"]
