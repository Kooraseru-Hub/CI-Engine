# Repository

## Generated branches

Publish directories of generated repository output, one direct directory per branch. The caller chooses the input location. Branch names are derived from the directory names; the authored default branch is always skipped. The first commit is orphaned, subsequent commits preserve history, and an unchanged tree does not create a commit. A concurrent remote change is rejected; the package never force-pushes.

Requires Git and Node.js 20+. From the consuming repository:

```sh
node /path/to/ci-packages/packages/repository/branches.mjs --directory build/github/branches --repository owner/repo --default-branch source
```

Without `--publish`, this validates every directory and makes no remote calls. For explicit publication, add `--publish` and supply `GH_TOKEN` with Contents: write. Use `packages/repository/branches` in a trusted workflow with `directory`, `repository`, `default-branch`, and explicit `confirm: 'true'`.

The test suite uses a temporary local bare Git repository and never modifies an external repository.
