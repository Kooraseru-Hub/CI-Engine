# Releases

## Verify staged artifacts

Checks the existing staged release index and each referenced notes file and asset before publication. Verifies SHA-256 digests and rejects paths outside the staged directory, symbolic links, duplicate tags and duplicate asset names. It does not publish or modify any files and needs no credentials.

Requires Node.js 20 or newer. Run from the consumer repository root:

```sh
node /path/to/ci-packages/packages/releases/verify.mjs --index build/artifacts/releases/index.json
```

The index path is explicit; both existing Template and Registry staging layouts are supported. Asset paths are workspace-relative and notes paths are index-directory-relative, matching the existing release index contract.

GitHub Actions:

```yaml
- uses: Kooraseru-Hub/CI-Engine/packages/releases/verify@<commit-sha>
  with:
    index: build/artifacts/releases/index.json
```

Checkout or download the staged files before calling the action. Run it after staging, before a publication job acquires write credentials.

Run the package tests with `node --test packages/releases/verify.test.mjs`.

## Publish staged releases

The standalone publisher verifies the entire index before any remote call, preserves the existing skip/fail/replace behavior, generates notes from historical tags, and verifies new asset digests before deleting replaced assets. Run it with Node.js 20+ and Git.

```sh
node /path/to/ci-packages/packages/releases/publish.mjs --index build/artifacts/releases/index.json --repository owner/repo
```

This is a read-only rehearsal. Add `--publish` and provide an authorized `GH_TOKEN` to publish. In Actions, use the `packages/releases/publish` composite action with `index`, `repository`, and `confirm: 'true'` only in a trusted job with Contents: write and an appropriate environment. The default is a credential-free rehearsal. The package does not select credentials or schedule jobs.

Run `node --test packages/releases/*.test.mjs` for mocked publication and artifact verification tests. The tests make no external mutations.
