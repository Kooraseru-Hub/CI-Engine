--!strict
-- Self-contained contract tests. All assertions run inside Lute without
-- Node, npm, or the consuming Template repository.
local Component = require("@engine/contracts/component")
local Graph = require("@engine/planning/graph")
local Glob = require("@engine/planning/glob")
local Outcome = require("@engine/execution/outcome")

local passed = 0

local function check(label: string, condition: boolean): ()
    if not condition then error("FAILED: " .. label, 0) end
    passed += 1
end

local function rejects(label: string, run: () -> ()): ()
    local ok = pcall(run)
    check(label, not ok)
end

local function make(identity: string, provides: { string }, requires: { string }?, overrides: any?): any
    local source: any = {
        provides = provides,
        requires = requires or {},
        command = { "git", "status" },
        boundary = "read",
        outputs = {},
    }
    if overrides then
        for key, value in overrides do source[key] = value end
    end
    return Component.Validate(identity, identity .. "/component.json", source)
end

check("valid nested identity", Component.ValidIdentity("quality/code-review"))
check("reject path traversal", not Component.ValidIdentity("quality/../secrets"))
check("allow dot-prefixed configured roots", Component.ValidRoot(".github/config/ci/components"))
check("reject absolute roots", not Component.ValidRoot("/tmp/components"))
rejects("unknown contract fields", function()
    make("test/unknown", { "test.unknown" }, {}, { unrecognized = true })
end)
rejects("sparse capabilities", function()
    make("test/sparse", { [2] = "test.sparse" })
end)
rejects("duplicate capabilities", function()
    make("test/duplicates", { "test.duplicates", "test.duplicates" })
end)
rejects("invalid output traversal", function()
    make("test/output", { "test.output" }, {}, { outputs = { "build/../secrets" } })
end)
rejects("read-only credentials cannot be declared", function()
    make("test/secrets", { "test.secrets" }, {}, { credentials = { "github_token" } })
end)
rejects("invalid command shape", function()
    make("test/command", { "test.command" }, {}, { command = { "git", "\nsecret" } })
end)
rejects("invalid boundary", function()
    make("test/boundary", { "test.boundary" }, {}, { boundary = "admin" })
end)

local prepared = make("tools/setup", { "tools.prepare" })
local checked = make("quality/check", { "quality.checked" }, { "tools.prepare" })
local planned = Graph.Plan({ ["quality/check"] = checked, ["tools/setup"] = prepared },
    { "quality/*" }, "pull_request", "readonly")
check("unselected capability provider is discovered", #planned.ordered == 2
    and planned.ordered[1] == "tools/setup" and planned.ordered[2] == "quality/check")
check("dependency edges are retained", #planned.needs["quality/check"] == 1
    and planned.needs["quality/check"][1] == "tools/setup")

rejects("missing capability", function()
    Graph.Plan({ ["quality/check"] = checked }, { "*" }, "pull_request", "readonly")
end)
local cycleA = make("test/a", { "a" }, { "b" })
local cycleB = make("test/b", { "b" }, { "a" })
rejects("dependency cycle", function()
    Graph.Plan({ ["test/a"] = cycleA, ["test/b"] = cycleB }, { "*" }, "push", "readonly")
end)
local duplicateA = make("test/a", { "same.capability" })
local duplicateB = make("test/b", { "same.capability" })
rejects("duplicate capability providers", function()
    Graph.Plan({ ["test/a"] = duplicateA, ["test/b"] = duplicateB }, { "*" }, "push", "readonly")
end)
local overlappingA = make("test/a", { "artifact.a" }, {}, { outputs = { "build/out.bin" } })
local overlappingB = make("test/b", { "artifact.b" }, {}, { outputs = { "build/*.bin" } })
rejects("output ownership collision", function()
    Graph.Plan({ ["test/a"] = overlappingA, ["test/b"] = overlappingB }, { "*" }, "push", "readonly")
end)
check("glob recursive match", Glob.Match("build/artifacts/a/output.bin", "build/**/output.bin"))
check("glob overlapping patterns", Glob.Overlaps("build/*.bin", "build/out.bin"))
check("glob distinct patterns", not Glob.Overlaps("build/*.bin", "build/*.txt"))

local privileged = make("test/publish", { "publish.release" }, {}, { boundary = "privileged", credentials = { "release" } })
rejects("privileged task rejected by read-only graph", function()
    Graph.Plan({ ["test/publish"] = privileged }, { "*" }, "push", "readonly")
end)
local filtered = make("test/filtered", { "filtered" }, {}, { events = { "release" } })
local compatible = Graph.Plan({ ["test/filtered"] = filtered, ["tools/setup"] = prepared },
    { "tools/*" }, "pull_request", "readonly")
check("event-filtered components remain excluded", #compatible.ordered == 1
    and compatible.ordered[1] == "tools/setup")

check("exit success mapping", Outcome.FromExitCode(0) == "passed")
check("exit skip mapping", Outcome.FromExitCode(Outcome.skippedExitCode) == "skipped")
check("exit failure mapping", Outcome.FromExitCode(1) == "failed")
print("CI Engine: " .. passed .. " contract and planner tests passed")
