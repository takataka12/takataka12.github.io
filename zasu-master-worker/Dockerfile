FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NUMBA_CACHE_DIR=/app/.numba_cache
ENV NUMBA_NUM_THREADS=1
ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
ENV MKL_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 coreutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
COPY punch_engine.b64.* /app/
RUN cat /app/punch_engine.b64.* | base64 -d > /app/punch_engine.py \
    && rm /app/punch_engine.b64.* \
    && mkdir -p /app/.numba_cache \
    && python -c "import numpy as np, punch_engine as p; p._gain_envelope_numba(np.array([0.1,0.2,0.1],dtype=np.float64),0.5,1,0.99); print('PUNCH numba cache ready')"

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
