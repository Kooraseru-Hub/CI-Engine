--!strict
local Operation = require("@engine/configuration/operation")
local passed = 0
local function check(name: string, good: boolean)
    if not good then error("FAILED: " .. name, 0) end
    passed += 1
end
local function rejects(name: string, handler: () -> ())
    check(name, not pcall(handler))
end
local cfg = {version = 1, operations = {
    review = { mode = "readonly", events = { "pull_request" }, components = { "quality/*" } },
    build = { mode = "readonly", events = { "workflow_dispatch" }, components = { "quality/*" } },
    publish = { mode = "staged", events = { "workflow_dispatch" }, components = { "quality/*" },
        publication = true, delivery = { command = { "node", "plan.cjs" } } },
}}
local pr = {event = "pull_request", ref = "refs/heads/topic", defaultBranch = "main", requested = "review", confirmPublish = false}
check("review is read-only", Operation.Resolve(cfg, pr).mode == "readonly")
local trusted = {event = "workflow_dispatch", ref = "refs/heads/main", defaultBranch = "main", requested = "publish", confirmPublish = true}
check("trusted staged publication", Operation.Resolve(cfg, trusted).publication)
for _, change in {{confirmPublish=false},{ref="refs/heads/topic"},{event="pull_request"},{event="push"},{localExecution=true}} do
    local request: any = table.clone(trusted)
    for key, value in change do request[key] = value end
    rejects("untrusted delivery", function() Operation.Resolve(cfg, request) end)
end
local build: any = table.clone(trusted)
build.requested = "build"
build.confirmPublish = false
build.localExecution = true
build.ref = "refs/heads/topic"
check("build works locally without generation", Operation.Resolve(cfg, build).mode == "readonly")
local invalid: any = table.clone(cfg)
invalid.operations = table.clone(cfg.operations)
invalid.operations.build = { mode = "generated", events = {"workflow_dispatch"}, components={"*"} }
rejects("retired generation mode", function() Operation.Resolve(invalid, build) end)
invalid.operations.build = { mode = "readonly", events = {"workflow_dispatch"}, components={"*"}, delivery={command={"node"}} }
rejects("read-only cannot declare delivery", function() Operation.Resolve(invalid, build) end)
invalid.operations.build = {mode="readonly",events={"workflow_dispatch"},components={"*"},hostTests={command={},artifactPath="build/out"}}
rejects("host test commands must not be empty", function() Operation.Resolve(invalid, build) end)
rejects("missing operation", function() Operation.Resolve(cfg, {event="pull_request",ref=pr.ref,defaultBranch="main",requested="",confirmPublish=false}) end)
print("CI Engine: " .. passed .. " operation routing tests passed")
