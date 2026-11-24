# CI Engine

A reusable CI execution framework with an independent dispatch run. Consumers own event admission, operation declarations, and components. The engine owns scheduling, permission enforcement, artifacts, and terminal status.

## Execution

One immutable request selects one operation from `config/ci/operations.json`. The workflow resolves and prepares it, discovers components, inspects the requested trust boundary, plans, authorizes, executes, tests, optionally publishes, collects, cleans up, and reports status. No hosted execution builds a temporary workflow or branch.

Read-only operations declare component patterns and optional `hostTests`. Native test matrices consume artifacts from the same run. Staged operations additionally declare `publication: true` and a `delivery.command` which writes a JSON plan to `CI_DELIVERY_PLAN_FILE`. Staged delivery requires an explicitly confirmed, admitted default-branch manual dispatch. Build and native tests must succeed first. Local execution cannot publish.

## Delivery contract

The plan declares `jobs` with an identity, permission lane, environment, command argument vector, optional nonsecret environment, and up to three explicit named credential bindings. It may also declare an artifact source/destination and a read-only candidate preparation command. The supported static permission lanes are contents, issues, credential, pages, and external (PR comment authority). Pages uses job-scoped OIDC; credential values never enter the plan or artifacts. Candidate code is compiled without publishing credentials and the publisher runs on a fresh immutable trusted checkout. The native planner derives publication jobs from component contracts and configured native permissions.

## Optional observation API

The event-side client at the pinned engine revision exposes `connect`, `status <run-id>`, and `wait <run-id> [phase]`. Consumers may await any phase or the overall terminal result without subscribing to intermediate phases. Signals observe same-run jobs; subscriptions do not alter execution or permissions.

## Local execution

The managed CLI stages the pinned engine for act and simulates dispatch admission locally. It executes the same read-only graph, omitting hosted Windows runners. Native build bundles include a verified build plan and provenance; the adapter exports manifest-owned products only after successful execution. No deployment or remote branch generation occurs locally.

### Reusable-workflow credential transport

GitHub requires environment secret names to be forwarded by reusable-workflow callers. The workflow exposes only `CI_SECRET_0`, `CI_SECRET_1` and `CI_SECRET_2`. Consumers declare their credential roles and map them to these names within each protected environment; the caller forwards the fixed names explicitly. The same slot can hold different credentials in different environments. Never put credentials at repository scope to satisfy forwarding, and never pass the complete secrets context. The selected job receives only its declared bindings. Variables retain consumer-defined names. Provider-specific names and configuration belong to the consumer, not the engine.
