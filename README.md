# CI Engine

A language-agnostic CI bootstrap and execution contract. Project repositories declare operations and components; the engine never contains project- or language-specific targets.

## Development status

This is a **draft extraction**, not a production-ready CI replacement. The initial backend handles unprivileged commands sequentially in an isolated GitHub runner and deliberately refuses privileged operations and module-backed components. Native multi-job DAGs, isolated publication, credential selection, cross-platform portability, reporting, and provenance validation are not complete. Do not tag `v1` or migrate consumers until these pass.

## Interface

A consumer calls `.github/workflows/bootstrap.yml` via `workflow_call`, passing an optional `operation` input. The engine reads `.github/config/ci/engine.json` from the consumer and discovers tracked `ci/components/**/component.json` manifests. Operation selection is driven by GitHub event and config. Read-only commands are argument arrays, not shell strings.

The engine relies on Lute's built-in JSON parser; neither bootstrap nor contract parsing calls Node. The engine's reusable workflow intentionally does not have `workflow_dispatch`, so it is not independently advertised for manual runs. Each consumer owns its user-facing `ci.yml`. It invokes the engine's root composite action through GitHub's same-repository `$/` syntax, binding the action to the exact engine revision of the called workflow without another checkout. `$/` currently requires GitHub.com Actions, not GitHub Enterprise Server.

## Security contract

The engine uses `contents: read`, does not persist checkout credentials, rejects privileged components, and does not bind secrets. This version must not receive or execute privileged operations. A separate trusted GitHub executor is required before publication is supported.

## Implementation principle

Like Workbench Bridge, extension contracts are stable while external components supply functionality. Languages and build tools are never enumerated by the engine. GitHub platform capabilities are adapted at the boundary, not hardcoded into component logic.

## Extracted from Template PR #43

The current extraction restores validated component metadata, deterministic capability DAG planning, tracked-entry and symlink safety checks, glob matching/output collision detection, and outcome/output verification. Unlike the original controller, the reusable contract does **not** enumerate languages, project branches, permitted event names, or `build`/`publish` phases.

A component's `requires` entries name capabilities. The engine includes their eligible providers automatically, retains graph edges, rejects ambiguous providers and cycles, and fails closed if read-only work requests credentials. Contracts are stored as `component.json` under a configurable repository-owned directory. A command component is independent of the engine's implementation language.

The original Template's credential selector, publication logic, GitHub resource management, and generated eight-job controller are **not imported**. They are project-specific or need a separate trust review. The privileged backend remains unimplemented; this extraction does not grant publication rights.

The engine's own PR verification executes contract/planner regression tests without any dependency on Template.
