REGISTRY ?= ghcr.io/certdax
IMAGE    ?= certdax-k8s-operator
TAG      ?= latest

.PHONY: build docker-push manifests generate fmt vet

build:
	CGO_ENABLED=0 go build -o bin/operator ./main.go

docker:
	docker build -t $(REGISTRY)/$(IMAGE):$(TAG) .

docker-push: docker
	docker push $(REGISTRY)/$(IMAGE):$(TAG)

fmt:
	go fmt ./...

vet:
	go vet ./...

generate:
	controller-gen object:headerFile="hack/boilerplate.go.txt" paths="./..."
	controller-gen crd paths="./..." output:crd:artifacts:config=helm/certdax-operator/templates

test:
	go test ./... -v
