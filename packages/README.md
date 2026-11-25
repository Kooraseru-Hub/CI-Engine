# CI packages

Each directory is an independently callable capability. Use the package directly from a GitHub Actions workflow or the command line. GitHub Actions owns scheduling, job dependencies, permissions, environments, and artifact transfer.

- [releases](releases/README.md): verify and publish staged release artifacts.
- [repository](repository/README.md): verify and publish generated repository branches.

Package conventions:

- Keep the executable and its tests inside the package. A composite action can wrap the executable for hosted use.
- Accept explicit inputs and configuration paths, relative to the consumer repository unless documented otherwise. Never require a particular project directory structure.
- Use the caller's working directory for project inputs and the executable's own location for package resources.
- Declare runtime requirements and credentials in the package's README. Never infer publishing authority from the existence of a token; mutation must be requested by a trusted workflow with narrowly scoped permissions.
- Return nonzero on failure. Use native action outputs when the caller needs machine-readable results.
- No scheduler, component discovery, or workflow generator.

Example local invocation from a consumer checkout, with the package repository installed at any location:

```sh
node /path/to/ci-packages/packages/releases/verify.mjs --index build/artifacts/releases/index.json
```

Example hosted invocation (replace the ref with a reviewed immutable commit SHA):

```yaml
- uses: Kooraseru-Hub/CI-Engine/packages/releases/verify@<commit-sha>
  with:
    index: build/artifacts/releases/index.json
```

No package registry or package discovery mechanism is needed. The repository name is temporary. Consumers of the former engine must remain pinned to a historical engine revision until they migrate.
