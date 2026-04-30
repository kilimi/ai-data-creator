# Run from repository root. Requires Docker Compose v2.24+ (for `include` in docker-compose.yml).
COMPOSE ?= docker compose
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: install check-sam3 up down logs ps build pull up-no-build help

help:
	@echo "Targets: install | check-sam3 | up | down | logs | ps | build | pull | up-no-build"
	@echo "  install      guided setup: Docker/Compose, data dir, web port, SAM 3, optional host code bind"
	@echo "  check-sam3   exit 1 if SAM 3 weights missing (for scripts/CI)"
	@echo "  up           docker compose up -d (build if needed)"
	@echo "  down         stop stack"
	@echo "  pull         pull images (set LAI_*_IMAGE in .env first)"
	@echo "  up-no-build  start without building (after pull)"
	@echo "  build        build all images"
	@echo "  logs         follow logs"
	@echo "  ps           service status"

install:
	bash "$(ROOT)/scripts/install.sh"

check-sam3:
	@bash "$(ROOT)/scripts/check_sam3.sh"

up:
	cd "$(ROOT)" && $(COMPOSE) up -d

down:
	cd "$(ROOT)" && $(COMPOSE) down

logs:
	cd "$(ROOT)" && $(COMPOSE) logs -f

ps:
	cd "$(ROOT)" && $(COMPOSE) ps

build:
	cd "$(ROOT)" && $(COMPOSE) build

pull:
	cd "$(ROOT)" && $(COMPOSE) pull

up-no-build:
	cd "$(ROOT)" && $(COMPOSE) up -d --no-build
