FROM python:3.11-slim
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Never run the API as root.
RUN useradd --system --uid 10001 app && chown -R app /code
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status != 200)"
# One process on purpose: rate limits and pending confidence scores are
# in-process (see app/http_guard.py). Sync routes still run concurrently in
# uvicorn's thread pool. --proxy-headers trusts X-Forwarded-For only from
# FORWARDED_ALLOW_IPS (default 127.0.0.1); set it to your proxy's address,
# never "*", or clients can spoof their IP past the rate limiter.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--timeout-keep-alive", "5"]
