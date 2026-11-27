# CI Packages

Independent, reusable CI operations for native GitHub Actions and local execution. GitHub Actions owns job scheduling, dependencies, permissions, and artifact transport.

| Package | Operations |
| --- | --- |
| [Releases](packages/releases/README.md) | Verify and publish staged release records and assets |
| [Repository](packages/repository/README.md) | Validate and publish generated branches |
| [Documentation](packages/documentation/README.md) | Shared Astro renderer, generic parity comparison, and Cloudflare Pages preview lifecycle |
| [DevForum](packages/devforum/README.md) | Native PNG uploads and public post verification |
| [Roblox](packages/roblox/README.md) | Historical RBXM model generation |

Each package documents its inputs, runtime, authorization and tests. Publication defaults to a read-only rehearsal and requires explicit confirmation to write.

See [package conventions](packages/README.md). Run all tests with Node.js 24 and Git:

```sh
node --test packages/releases/*.test.mjs packages/repository/*.test.mjs packages/documentation/preview.test.cjs packages/documentation/renderer.test.cjs packages/devforum/*.test.cjs packages/roblox/*.test.cjs
```

The former scheduler is not part of this distribution. Existing consumers pinned to historical commits can continue using those commits while migrating.
