#!/usr/bin/env bash
set -euo pipefail

# Invoked from the consuming repository root.

case "${CI_ENGINE_MODE:-readonly}:${CI_ORIGIN_EVENT:-pull_request}" in
  staged:*|readonly:push) export CI_EVENT=push ;;
  readonly:workflow_dispatch) export CI_EVENT=workflow_dispatch ;;
  *) export CI_EVENT=pull_request ;;
esac
export CI_OPERATION="${CI_ENGINE_SELECTED_OPERATION:-validation}"
export CI_GRAPH_RUN=true
export CI_PHASE=build

node dependencies/packages/core/dependencyLoader/index.ts --exec tools.ciEngine native --stage build
bash "$(dirname -- "${BASH_SOURCE[0]}")/test.sh"
