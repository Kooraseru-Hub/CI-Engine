# Roblox

Build uncompressed Roblox binary models containing ModuleScripts and Folders from an explicit historical Git commit. Extracted from Registry's existing model writer. The caller chooses the root name, source file or module directory and output file. A directory root must contain an init.lua or init.luau ModuleScript.

Requires Node.js 24 and Git. From the consumer checkout:

```sh
node /path/to/ci-packages/packages/roblox/model.cjs "$(git rev-parse HEAD)" source/Module.luau build/Module.rbxm Module
```

Use `packages/roblox/model` with `commit`, `source`, `output`, and `name` in a workflow. For historical releases, fetch the corresponding Git history first. For ZIP source distributions, use native `git archive`; no wrapper package is required. For full Roblox projects or more complex instance trees use established tools such as Rojo.

Tests validate the binary chunk structure, deterministic encoding and historical Git reads. They do not launch Roblox Studio.
