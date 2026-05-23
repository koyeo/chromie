SHELL  := /bin/bash
ROOT   := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ENTRY  := $(ROOT)/packages/cli/dist/bin.js

PREFIX  ?= /usr/local
BIN_DIR := $(PREFIX)/bin
TARGET  := $(BIN_DIR)/chromie

.PHONY: all deps build install uninstall reinstall clean help

all: install

deps:
	pnpm install

build: deps
	pnpm -r build

install: build
	@mkdir -p "$(BIN_DIR)" 2>/dev/null || { \
		echo "Cannot create $(BIN_DIR)."; \
		echo "Try:  sudo make install"; \
		echo "  or: PREFIX=\$$HOME/.local make install   (ensure ~/.local/bin is on PATH)"; \
		exit 1; \
	}
	@printf '#!/bin/sh\nexec node "%s" "$$@"\n' "$(ENTRY)" > "$(TARGET)" 2>/dev/null || { \
		echo "Cannot write $(TARGET)."; \
		echo "Try:  sudo make install"; \
		echo "  or: PREFIX=\$$HOME/.local make install"; \
		exit 1; \
	}
	@chmod +x "$(TARGET)"
	@echo "Installed: $(TARGET)"
	@echo "          -> $(ENTRY)"
	@echo "Try:       chromie --help"

uninstall:
	@rm -f "$(TARGET)"
	@echo "Removed: $(TARGET)"

reinstall: uninstall install

clean:
	rm -rf packages/cli/dist

help:
	@echo "Targets:"
	@echo "  make              Build and install chromie (default)"
	@echo "  make build        Install deps and compile TypeScript"
	@echo "  make install      Install chromie shim into $(BIN_DIR)"
	@echo "  make uninstall    Remove the chromie shim"
	@echo "  make reinstall    uninstall + install"
	@echo "  make clean        Remove dist/ build output"
	@echo ""
	@echo "Install location:"
	@echo "  Default PREFIX=$(PREFIX)  (BIN_DIR=$(BIN_DIR))"
	@echo "  Override:  PREFIX=\$$HOME/.local make install"
	@echo "  Or:        sudo make install"
