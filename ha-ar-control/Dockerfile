# HA AR Control — Docker image
# Build:  docker build -t ha-ar-control .
# Run:    docker compose up -d
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HA_AR_DATA=/data \
    PORT=8100

WORKDIR /app

# OpenCV needs libGL at runtime (headless build still links it).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY app/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir opencv-python-headless==4.10.0.84

COPY app/ ./app/
RUN mkdir -p /data/photos

EXPOSE 8100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8100/api/health || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8100", "--workers", "1", "--threads", "4", \
     "--timeout", "120", "app.app:app"]
