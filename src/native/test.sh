#!/usr/bin/env bash
set -euo pipefail
# Invoked from the consuming repository root.
node dependencies/packages/core/dependencyLoader/index.ts
node "$(dirname -- "${BASH_SOURCE[0]}")/bootstrap/run-tests.cjs"
