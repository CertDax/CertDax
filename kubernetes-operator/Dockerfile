FROM golang:1.23-alpine AS builder
RUN apk add --no-cache yq
WORKDIR /app
COPY . .
RUN go mod tidy && go mod download
RUN VERSION=$(yq '.appVersion' helm/certdax-operator/Chart.yaml) && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags "-X main.version=${VERSION}" -o /operator ./main.go

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /operator /operator
USER 65532:65532
ENTRYPOINT ["/operator"]
