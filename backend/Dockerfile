# Stage 1: Build agent binaries for all architectures
FROM golang:1.23-alpine AS agent-builder

ARG AGENT_VERSION=1.0.0

WORKDIR /build
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/main.go agent/certstore_windows.go agent/certstore_other.go ./

RUN CGO_ENABLED=0 GOOS=linux  GOARCH=amd64 go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/certdax-agent-linux-amd64   . && \
    CGO_ENABLED=0 GOOS=linux  GOARCH=arm64 go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/certdax-agent-linux-arm64   . && \
    CGO_ENABLED=0 GOOS=linux  GOARCH=arm   go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/certdax-agent-linux-arm     . && \
    CGO_ENABLED=0 GOOS=linux  GOARCH=386   go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/certdax-agent-linux-386     . && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o /out/certdax-agent-windows-amd64.exe .

# Stage 2: Backend application
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl osslsigncode nsis && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/

# Copy agent binaries from builder stage
COPY --from=agent-builder /out/ ./agent-dist/

RUN useradd --create-home --no-log-init appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
