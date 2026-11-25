# Documentation

Cloudflare Pages preview lifecycle, extracted from the working Template publisher. The consuming project owns its renderer, authored Markdown, theme, and static output directory. GitHub Pages production deployment uses the official Pages actions.

Use `packages/documentation/preview` with `config` (TOML containing `[github.previews]`), `directory` (static site), and `mode`. Default `rehearse` validates static output without network or credentials. `build-settings` emits base/site for a PR. `manual-resolve` resolves a manual target. `native`, `manual`, and `retire` perform the existing trusted preview lifecycle.

CLI: `PREVIEW_CONFIG=path/to/targets.toml PREVIEW_DIRECTORY=path/to/site GITHUB_REPOSITORY=owner/repo node publish.cjs --rehearse`.

Real publication requires a protected workflow, `GH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CI_DEFAULT_BRANCH`, and the trusted PR/dispatch context. No PR code executes with these credentials. Static assets are checked before upload; retirement replaces the alias with a 410 Worker and prunes prior deployments. No live publication occurs in package tests.

Run `node --test packages/documentation/*.test.cjs`.
