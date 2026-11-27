# Documentation

Shared Astro/Starlight renderer, generic browser/structural parity tools, and Cloudflare Pages preview lifecycle. The consumer owns authored Markdown/MDX, assets, theme overrides, parity sources and acceptance policy. GitHub Pages production deployment uses the official Pages actions.

Use `packages/documentation/preview` with `config` (TOML containing `[github.previews]`), `directory` (static site), and `mode`. Default `rehearse` validates static output without network or credentials. `build-settings` emits base/site for a PR. `manual-resolve` resolves a manual target. `native`, `manual`, and `retire` perform the existing trusted preview lifecycle.

CLI: `PREVIEW_CONFIG=path/to/targets.toml PREVIEW_DIRECTORY=path/to/site GITHUB_REPOSITORY=owner/repo node publish.cjs --rehearse`.

Real publication requires a protected workflow, `GH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CI_DEFAULT_BRANCH`, and the trusted PR/dispatch context. No PR code executes with these credentials. Static assets are checked before upload; retirement replaces the alias with a 410 Worker and prunes prior deployments. No live publication occurs in package tests.

Run `node --test packages/documentation/*.test.cjs`.

## Build

Run from the consumer root with Node.js 24: `node /path/to/CI-Packages/packages/documentation/build/renderer/build.cjs`. The composite `packages/documentation/build` wraps that command. Defaults can be overridden by `DOCS_ROOT`, `DOCS_DIRECTORY`, `DOCS_IMAGES`, `DOCS_THEME`, `DOCS_FAVICON`, `DOCS_OUTPUT`, `DOCS_BASE`, `DOCS_SITE`, `DOCS_TITLE`, `DOCS_CACHE` and `DOCS_EDIT_URL`. The builder installs its exact direct runtime dependencies if missing. Source MDX can import the renderer components using relative paths from its staged content directory. The consumer's inputs and published output are separate from the installed renderer. No parity corpus is included in the package.

## Parity

The `parity/` modules export capture, comparison, structural snapshots and a cross-source component catalogue. Callers supply the source registry, experiment directory and rule policy via `Create(settings).Check({root, product, output, mode, rule})`. Class normalization is data-driven using `settings.classNormalization` (drop regexes and pattern/replacement pairs). The package does not select external reference URLs or impose a consumer-specific parity rule. Ordinary documentation builds do not run parity.
