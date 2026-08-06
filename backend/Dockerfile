FROM python:3.11-slim

WORKDIR /app

# OpenCV (imported via ultralytics/onnxruntime) needs libGL at runtime.
# The old package name `libgl1-mesa-glx` was removed in Debian 12 (Bookworm),
# which now ships as the base for python:3.11-slim. Use `libgl1` instead.
# `libglib2.0-0` is still named the same way.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

