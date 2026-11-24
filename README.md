# CI Engine

A reusable CI execution framework with an independent dispatch run. Consumers own event admission, operation declarations, and components. The engine owns scheduling, permission enforcement, artifacts, and terminal status.

## Execution

One immutable request selects one operation from `config/ci/operations.json`. The workflow resolves and prepares it, discovers components, inspects the requested trust boundary, plans, authorizes, executes, tests, optionally publishes, collects, cleans up, and reports status. No hosted execution builds a temporary workflow or branch.

Read-only operations declare component patterns and optional `hostTests`. Native test matrices consume artifacts from the same run. Staged operations additionally declare `publication: true` and a `delivery.command` which writes a JSON plan to `CI_DELIVERY_PLAN_FILE`. Staged delivery requires an explicitly confirmed, admitted default-branch manual dispatch. Build and native tests must succeed first. Local execution cannot publish.

## Delivery contract

The plan declares `jobs` with an identity, permission lane, environment, command argument vector, optional nonsecret environment, and explicit named credential bindings. It may also declare an artifact source/destination and a read-only candidate preparation command. The supported static permission lanes are contents, issues, credential, pages, and external (PR comment authority). Pages uses job-scoped OIDC; credential values never enter the plan or artifacts. Candidate code is compiled without publishing credentials and the publisher runs on a fresh immutable trusted checkout. The native planner derives publication jobs from component contracts and configured native permissions.

## Optional observation API

The event-side client at the pinned engine revision exposes `connect`, `status <run-id>`, and `wait <run-id> [phase]`. Consumers may await any phase or the overall terminal result without subscribing to intermediate phases. Signals observe same-run jobs; subscriptions do not alter execution or permissions.

## Local execution

The managed CLI stages the pinned engine for act and simulates dispatch admission locally. It executes the same read-only graph, omitting hosted Windows runners. Native build bundles include a verified build plan and provenance; the adapter exports manifest-owned products only after successful execution. No deployment or remote branch generation occurs locally.

### Environment credential delivery

For hosted dispatch, install the engine at an immutable revision and run `CI Engine sync-workflow` through the managed dependency loader. Commit the generated `.github/workflows/bootstrap.yml` alongside configuration changes; `sync-workflow --check` verifies conformance. Event entry points continue to dispatch independent `ci-request` runs. The generated controller is a direct GitHub job graph, with execution delegated to the pinned engine composite action. No temporary workflow or branch is created during hosted execution.

Declare role-to-name bindings in `config/credentials.json` under `environments`, using `secrets.NAME` or `vars.NAME` aliases. Use protected environments and preserve existing GitHub credential names. The generator emits name-specific step expressions gated by the authorized environment and matrix selection. Values never enter the plan, job outputs, artifacts, or a serialized inventory. The delivery adapter exposes only selected roles to the component, fails on missing required bindings, and supports explicitly optional bindings (`required: false`) in custom plans. No engine-side credential inventory, fixed slot count, or inherited secret context is required.

GitHub's reusable workflow boundary can hide environment secrets unless the caller explicitly forwards the names. The shared reusable workflow remains available for smoke/read-only and credential-free execution; it deliberately fails if used for a required named credential. Direct environment jobs avoid that forwarding boundary. GitHub's own environment secret limits still apply.

The generated YAML is a platform adapter, not consumer business logic. Configuration owns names, roles and environments; the engine owns scheduling, authorization and execution.

GitHub-native adapters may request App, token, or project/ruleset roles when that capability is selected. Those roles are not mandatory for generic operations. For APIs beyond the job token's supported permission lanes, use a narrowly scoped GitHub App installation token, PAT, or external credential in a protected environment; the engine does not grant organization administration by default.
