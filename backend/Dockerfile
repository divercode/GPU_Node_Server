FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AUTH_MODE=proxy \
    PORTAL_BIND=0.0.0.0 \
    PORTAL_PORT=8000 \
    PORTAL_CONFIG_PATH=/app/config.json \
    PORTAL_USERS_FILE=/app/auth_users.json

WORKDIR /app

RUN groupadd --system portal && useradd --system --gid portal --uid 10001 --create-home portal

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r /app/requirements.txt

COPY backend/app.py backend/auth.py backend/store.py backend/config.json backend/auth_users.json /app/
RUN chown -R portal:portal /app

USER portal
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"

CMD ["python", "app.py"]
