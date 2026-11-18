#!/usr/bin/env bash
set -euo pipefail

# Invoked from the consuming repository root.

export CI_EVENT="${CI_EVENT:-pull_request}"
export CI_OPERATION=validation
export CI_GRAPH_RUN=true
export CI_PHASE=build

node dependencies/packages/core/dependencyLoader/index.ts --exec tools.ciEngine native --stage build
bash "$(dirname -- "${BASH_SOURCE[0]}")/test.sh"
