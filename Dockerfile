FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend backend
COPY ingestion ingestion
COPY db db
COPY data data

ENV DB_PATH=/data/nfl.db
# Cloud Run injects PORT at runtime (defaults to 8080) and requires the
# container to listen on it — a hardcoded port fails health checks there.
# Render (render.yaml) sets PORT itself too, so this stays compatible with
# both hosts. The default here only matters for `docker run` without
# either platform setting it.
ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
