FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o /operator ./main.go

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /operator /operator
USER 65532:65532
ENTRYPOINT ["/operator"]
