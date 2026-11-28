# Documentation

Documentation build and Cloudflare Pages preview integration. The [Documentation repository](https://github.com/Kooraseru-Hub/Documentation) owns the renderer and parity development. Consumers own authored content and optional branding.

Use `packages/documentation/preview` with `config` (TOML containing `[github.previews]`), `directory` (static site), and `mode`. Default `rehearse` validates static output without network or credentials. `build-settings` emits base/site for a PR. `manual-resolve` resolves a manual target. `native`, `manual`, and `retire` perform the existing trusted preview lifecycle.

CLI: `PREVIEW_CONFIG=path/to/targets.toml PREVIEW_DIRECTORY=path/to/site GITHUB_REPOSITORY=owner/repo node publish.cjs --rehearse`.

Real publication requires a protected workflow, `GH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CI_DEFAULT_BRANCH`, and the trusted PR/dispatch context. No PR code executes with these credentials. Static assets are checked before upload; retirement replaces the alias with a 410 Worker and prunes prior deployments. No live publication occurs in package tests.

Run `node --test packages/documentation/*.test.cjs`.

## Build

Use `packages/documentation/build` with `directory`, `images`, `output` and optional `theme`, `base`, `site`, and `renderer-ref`. The build action fetches the public Documentation repository at an immutable commit and runs its standalone renderer. A consumer may select a different renderer revision without changing the CI action version. The package contains no renderer implementation or parity tooling.

Documentation parity and all comparison fixtures are maintained and tested in Documentation itself. Ordinary consumer builds do not install the visual comparison tooling.
