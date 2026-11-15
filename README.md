# CI Engine

A reusable, language-independent CI coordinator. Repositories own their operations, component manifests, toolchains, and publishing adapters. The engine owns GitHub workflow admission, operation resolution, dependency planning, execution boundaries, and the final result.

## Entry points

- **.github/workflows/bootstrap.yml** – a reusable workflow_call entry point, not a second manually runnable workflow
- **action.yml** – an independently usable composite action supporting resolve, execute and generated phases
- **src/** – the generic Lute runtime, without requiring a Node controller or any particular project language

The consumer's only permanent CI workflow calls Kooraseru-Hub/CI-Engine/.github/workflows/bootstrap.yml at an exact full commit SHA.

The consumer declares triggers and operations in .github/config/ci/engine.json. Read-only operations discover tracked component manifests, validate contracts, resolve capability dependencies, reject cycles and output collisions, then execute command arrays. Dependency providers execute before their consumers.

Generated operations invoke a **repository-owned execution adapter** only after the engine's separate trusted job passes its event, default-branch and protected-environment checks. Such an adapter can compile GitHub-native workflow DAGs, dispatch them, verify completion, publish, manage generated branches, and clean up. The engine does not hardcode toolchains, publishers, phases, or repository names. A nonzero adapter exit fails the required final result.

The reusable workflow exposes a single strictly linear graph: Resolve Operation → Prepare Dependencies → Discover Components → Plan Execution → Authorize Operation → Execute Pipeline → Collect Results → Cleanup → validate. Each job runs for every selected operation; read-only versus generated execution is a decision inside the Execute Pipeline job, not a pair of mutually skipped GitHub jobs. GitHub cannot insert new native jobs into the current workflow run, so generated component DAGs use a separate dispatched workflow or external backend.

## Credentials and trust

Untrusted pull requests cannot request a generated operation, and never enter the privileged job. Read-only jobs have contents: read and no publisher credentials. The trusted job alone has id-token: write, an explicit protected GitHub environment, and optional app_private_key / bootstrap_token secret inputs alongside vars.CI_APP_ID.

Manual publication additionally requires explicit confirmation. Real package or extension registry OIDC trust must be registered at the external publisher; the engine cannot bypass GitHub's environment protections or manufacture that trust.

Cross-owner workflows should use explicitly mapped secret inputs rather than assume secrets: inherit works everywhere. Template's permanent launcher maps conventional CI_APP_PRIVATE_KEY and CI_TOKEN repository secrets. Consumer credentials must be configured in GitHub, not committed.

Pin external reusable workflow references to full commit SHAs. The engine owns its action dependencies in its own .github/workflows/actions.lock; a consumer action lock does not pin external reusable workflow calls.

## Verification

The engine's own fixtures exercise the reusable-workflow path, component contracts, dependency planning, and positive/negative operation routing, independently of Template. Its first-pass read-only implementation was extended with a generic trusted generated-operation adapter; project-specific publishers remain outside the engine.

This branch is an integration candidate, not a tagged v1 release. Passing engine and consumer CI verifies workflow admission and unprivileged execution but does not prove live publication to external registries.


## Local act compatibility

GitHub supports action self-references such as `uses: $/`, but some current versions of `act` do not. A consumer's local-only launcher may stage a temporary copy of the exact pinned reusable workflow and translate those self-references to `Kooraseru-Hub/CI-Engine@<sha>`. This must happen only inside a disposable checkout; do not edit the hosted engine workflow or replace `$/` with a moving branch ref.

## Credential boundary for a linear graph

GitHub permissions are job-scoped. The single `Execute Pipeline` job has `id-token: write` so it can run a trusted generated adapter when authorized; read-only components do **not** receive the OIDC token vending variables or bootstrap credentials in their subprocess environments. The job uses the separate `ci-readonly` environment for unprivileged execution and the selected protected environment for generated operations. External OIDC trusted-publisher registrations must trust only the protected publishing environment, never `ci-readonly`.

If strict job-level least privilege is required, the alternative is to split the read-only and privileged lanes into distinct GitHub jobs. That would reintroduce the skipped execution branch in the graph; it is a deliberate design tradeoff and must be revisited when changing trust policies.
