FROM python:3.12-slim
WORKDIR /app

COPY apps/vpn-legacy/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY apps/vpn-legacy/dashboard.py /app/dashboard.py

ENV PORT=5000

CMD ["python", "/app/dashboard.py"]
