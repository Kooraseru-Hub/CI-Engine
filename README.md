# CI Engine

A reusable, language-independent CI coordinator. Repositories own their operations, component manifests, toolchains, and publishing adapters. The engine owns GitHub workflow admission, operation resolution, dependency planning, execution boundaries, and the final result.

## Entry points

- **.github/workflows/bootstrap.yml** – a reusable workflow_call entry point, not a second manually runnable workflow
- **action.yml** – an independently usable composite action supporting resolve, execute and generated phases
- **src/** – the generic Lute runtime, without requiring a Node controller or any particular project language

The consumer's only permanent CI workflow calls Kooraseru-Hub/CI-Engine/.github/workflows/bootstrap.yml at an exact full commit SHA.

The consumer declares triggers and operations in .github/config/ci/engine.json. Read-only operations discover tracked component manifests, validate contracts, resolve capability dependencies, reject cycles and output collisions, then execute command arrays. Dependency providers execute before their consumers.

Generated operations invoke a **repository-owned execution adapter** only after the engine's separate trusted job passes its event, default-branch and protected-environment checks. Such an adapter can compile GitHub-native workflow DAGs, dispatch them, verify completion, publish, manage generated branches, and clean up. The engine does not hardcode toolchains, publishers, phases, or repository names. A nonzero adapter exit fails the required final result.

The reusable workflow exposes Resolve Operation, Execute Selected Components or Execute Configured Pipeline, and validate. Only one execution lane runs per operation. GitHub cannot insert new native jobs into the current workflow run, so generated DAGs use a separate dispatched workflow or external backend.

## Credentials and trust

Untrusted pull requests cannot request a generated operation, and never enter the privileged job. Read-only jobs have contents: read and no publisher credentials. The trusted job alone has id-token: write, an explicit protected GitHub environment, and optional app_private_key / bootstrap_token secret inputs alongside vars.CI_APP_ID.

Manual publication additionally requires explicit confirmation. Real package or extension registry OIDC trust must be registered at the external publisher; the engine cannot bypass GitHub's environment protections or manufacture that trust.

Cross-owner workflows should use explicitly mapped secret inputs rather than assume secrets: inherit works everywhere. Template's permanent launcher maps conventional CI_APP_PRIVATE_KEY and CI_TOKEN repository secrets. Consumer credentials must be configured in GitHub, not committed.

Pin external reusable workflow references to full commit SHAs. The engine owns its action dependencies in its own .github/workflows/actions.lock; a consumer action lock does not pin external reusable workflow calls.

## Verification

The engine's own fixtures exercise the reusable-workflow path, component contracts, dependency planning, and positive/negative operation routing, independently of Template. Its first-pass read-only implementation was extended with a generic trusted generated-operation adapter; project-specific publishers remain outside the engine.

This branch is an integration candidate, not a tagged v1 release. Passing engine and consumer CI verifies workflow admission and unprivileged execution but does not prove live publication to external registries.
