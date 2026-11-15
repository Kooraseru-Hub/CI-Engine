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

## Reusable GitHub workflow contract

A consumer keeps one permanent `.github/workflows/ci.yml` with a job that calls `Kooraseru-Hub/CI-Engine/.github/workflows/bootstrap.yml@<commit>`. This workflow owns generic **Resolve → Execute → Validate** jobs, and a separate generated-execution job protected by the repository's default-branch and GitHub environment checks. It has `workflow_call` only – it does not create a second manually runnable workflow.

The consumer's `.github/config/ci/engine.json` declares events, operations, component roots, and execution adapters. `readonly` operations discover component manifests and run without credentials. `generated` operations select a configured command-array adapter only after GitHub has admitted a trusted default-branch job; the adapter may generate GitHub-native workflows, create temporary branches, watch runs, and clean up. The engine never chooses a programming language, project branch name, or publication target. Nonzero adapter exits fail the required `validate` job. A manually requested publication requires explicit confirmation.

For repositories in different GitHub organizations, `secrets: inherit` is not portable. The reusable workflow instead accepts optional `app_private_key` and `bootstrap_token` named secret inputs. The simple caller can map conventional `CI_APP_PRIVATE_KEY` / `CI_TOKEN` GitHub secrets to them. The generated job alone receives them, alongside `vars.CI_APP_ID`, `id-token: write`, and its protected GitHub environment. The external publisher must still be registered with its OIDC trust provider; this workflow cannot manufacture that trust.

The caller must pin the reusable workflow by a **full commit SHA**. The GitHub Actions `actions.lock` file in this repository pins the actions used by the engine workflow; a caller's lockfile does not cover external reusable workflow dependencies. No credentials or operational settings are stored in the engine itself.

The original first-pass read-only-only workflow is superseded by this capability-based adapter contract. Privileged execution is available **only through trusted project-provided adapters**; the engine deliberately does not include application-specific publishers.
