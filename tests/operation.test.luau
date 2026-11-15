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
local cfg = {
    version = 1,
    triggers = { push = "review", pull_request = "review", workflow_dispatch = "review" },
    operations = {
        review = { mode = "readonly", events = { "push", "pull_request", "workflow_dispatch" },
            components = { "quality/*" } },
        publish = { mode = "generated", events = { "push", "workflow_dispatch" },
            publication = true, environment = "ci-bootstrap", plan = "build",
            branchPrefix = "run/publish-",
            execution = { command = { "git", "status", "--porcelain" } } },
        build = { mode = "generated", events = { "workflow_dispatch" },
            publication = false, environment = "ci-bootstrap", plan = "build",
            branchPrefix = "run/build-",
            execution = { command = { "git", "status" } } },
    },
}
local context = { event = "pull_request", ref = "refs/pull/2/merge", defaultBranch = "main",
    requested = "", confirmPublish = false }
local review = Operation.Resolve(cfg, context)
check("read-only PR routing", review.name == "review" and review.mode == "readonly")
rejects("untrusted PR cannot invoke publishing", function()
    local c = table.clone(context)
    c.requested = "publish"
    Operation.Resolve(cfg, c)
end)
local trusted = { event = "workflow_dispatch", ref = "refs/heads/main", defaultBranch = "main",
    requested = "publish", confirmPublish = true }
check("trusted publication", Operation.Resolve(cfg, trusted).publication)
rejects("manual publish without confirmation", function()
    local c = table.clone(trusted)
    c.confirmPublish = false
    Operation.Resolve(cfg, c)
end)
rejects("manual publish on non-default branch", function()
    local c = table.clone(trusted)
    c.ref = "refs/heads/topic"
    Operation.Resolve(cfg, c)
end)
rejects("no generated work on pull_request", function()
    local c = table.clone(trusted)
    c.event = "pull_request"
    c.requested = ""
    cfg.triggers.pull_request = "publish"
    Operation.Resolve(cfg, c)
end)
cfg.triggers.pull_request = "review"
local manual = table.clone(trusted)
manual.requested = "build"
manual.confirmPublish = false
check("trusted build without publication", not Operation.Resolve(cfg, manual).publication)
do
    local old = cfg.operations.build.execution
    cfg.operations.build.execution = nil
    local ok = pcall(function() Operation.Resolve(cfg, manual) end)
    cfg.operations.build.execution = old
    check("missing generated adapter rejected", not ok)
end

rejects("no privilege-escalating read-only command", function()
    local copy = table.clone(cfg)
    local operations = table.clone(cfg.operations)
    local bad = table.clone(cfg.operations.review)
    bad.execution = { command = { "echo" } }
    operations.review = bad
    copy.operations = operations
    Operation.Resolve(copy, context)
end)
print("CI Engine: " .. passed .. " operation routing tests passed")
