FROM golang:1.24-alpine AS builder

RUN apk upgrade --no-cache

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o certdax-agent .

FROM scratch
COPY --from=builder /build/certdax-agent /certdax-agent
ENTRYPOINT ["/certdax-agent"]
