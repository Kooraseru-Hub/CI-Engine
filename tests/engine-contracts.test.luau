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
-- Controller topology regression: one root, convergent asynchronous branches.
local Fs = require("@std/fs")
local workflow = Fs.readFileToString(".github/workflows/bootstrap.yml")
local action = Fs.readFileToString("action.yml")
check("native adapter output crosses composite action boundary",
    action:find("value: ${{ steps.engine.outputs.native }}", 1, true) ~= nil)
check("native adapter output crosses authorization job boundary",
    workflow:find("native: ${{ steps.permission.outputs.native }}", 1, true) ~= nil)
check("trusted source-push execution checks native adapter output",
    workflow:find("needs.authorize.outputs.native == 'true'", 1, true) ~= nil)
check("manual validation permits a guarded default-branch native launch",
    workflow:find("github.event_name == 'workflow_dispatch'", 1, true) ~= nil)

local expected: { [string]: { string } } = {
    resolve = {},
    prepare = { "resolve" },
    discover = { "resolve" },
    inspect = { "resolve" },
    plan = { "discover" },
    authorize = { "plan", "inspect" },
    execute = { "prepare", "authorize" },
    report = { "execute" },
    cleanup = { "report" },
    validate = { "cleanup" },
}
local labels: { [string]: string } = {
    resolve = "Resolve", prepare = "Prepare", discover = "Discover",
    inspect = "Inspect", plan = "Plan", authorize = "Authorize",
    execute = "Execute", report = "Collect", cleanup = "Cleanup",
    validate = "validate",
}
local found: { [string]: { string } } = {}
local names: { [string]: string } = {}
local inside = false
local current: string? = nil
for line in workflow:gmatch("[^\r\n]+") do
    if line == "jobs:" then inside = true end
    if inside then
        local header = line:match("^  ([a-z]+):$")
        if header then
            if expected[header] == nil then error("unexpected controller job " .. header, 0) end
            if found[header] ~= nil then error("duplicate controller job " .. header, 0) end
            current = header
            found[header] = {}
        elseif current ~= nil then
            local raw = line:match("^    needs: (.+)$")
            if raw then
                local values: { string } = {}
                for dependency in raw:gmatch("[a-z]+") do table.insert(values, dependency) end
                found[current] = values
            end
            local label = line:match("^    name: (.+)$")
            if label then names[current] = label end
            if line:match("^    if:") and current ~= "report" and current ~= "cleanup" and current ~= "validate" then
                error("controller stage is conditionally skipped: " .. current, 0)
            end
        end
    end
end
local count = 0
for job, dependencies in expected do
    count += 1
    local actual = found[job]
    check("controller includes " .. job, actual ~= nil)
    check("short job label " .. job, names[job] == labels[job])
    if not actual then error("missing " .. job, 0) end
    table.sort(actual)
    table.sort(dependencies)
    check("controller edges for " .. job,
        table.concat(actual, ",") == table.concat(dependencies, ","))
end
local present = 0
for _ in found do present += 1 end
check("no additional controller jobs", present == count)
check("controller branches after Resolve", #found.prepare == 1
    and #found.discover == 1 and #found.inspect == 1)
local roots = 0
for identity, dependencies in found do
    if #dependencies == 0 then
        check("only Resolve is a graph root", identity == "resolve")
        roots += 1
    end
end
check("exactly one controller entry point", roots == 1)
check("controller converges before Execute", #found.authorize == 2
    and #found.execute == 2)
check("protected operations execute within ordinary Execute", workflow:find("phase: protected", 1, true) ~= nil)
check("engine has no provider-specific dispatch", workflow:find("cloudflare", 1, true) == nil)
check("protected components have explicit scoped bindings", workflow:find("CI_COMPONENT_CREDENTIALS", 1, true) ~= nil)
local protectedPlan = Graph.Plan({ ["test/publish"] = privileged }, { "*" }, "repository_dispatch", "protected")
check("protected component uses normal dependency planner", #protectedPlan.ordered == 1)

print("CI Engine: " .. passed .. " contract and planner tests passed")
