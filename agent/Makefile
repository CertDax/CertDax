VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY  := certdax-agent
MODULE  := github.com/certdax/agent
LDFLAGS := -s -w -X main.version=$(VERSION)
GOFLAGS := CGO_ENABLED=0

DIST := dist

PLATFORMS := \
	linux/amd64 \
	linux/arm64 \
	linux/arm \
	linux/386 \
	windows/amd64

.PHONY: all clean build $(PLATFORMS)

all: $(PLATFORMS)

$(PLATFORMS):
	@mkdir -p $(DIST)
	$(eval GOOS := $(word 1,$(subst /, ,$@)))
	$(eval GOARCH := $(word 2,$(subst /, ,$@)))
	$(eval EXT := $(if $(filter windows,$(GOOS)),.exe,))
	@echo "Building $(BINARY) for $(GOOS)/$(GOARCH)..."
	$(GOFLAGS) GOOS=$(GOOS) GOARCH=$(GOARCH) go build -ldflags "$(LDFLAGS)" -o $(DIST)/$(BINARY)-$(GOOS)-$(GOARCH)$(EXT) .

build:
	@mkdir -p $(DIST)
	$(GOFLAGS) go build -ldflags "$(LDFLAGS)" -o $(DIST)/$(BINARY) .

clean:
	rm -rf $(DIST)
