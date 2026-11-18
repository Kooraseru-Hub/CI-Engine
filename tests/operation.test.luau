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
    requested = "review", confirmPublish = false }
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
    c.requested = "publish"
    Operation.Resolve(cfg, c)
end)
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
do
    local copy = table.clone(cfg)
    local operations = table.clone(cfg.operations)
    local work = table.clone(cfg.operations.review)
    work.native = { command = { "node", "ci/github/workflows/launch.cjs" } }
    operations.review = work
    copy.operations = operations
    check("read-only native adapter is a separately gated capability",
        Operation.Resolve(copy, context).mode == "readonly")
    work.native = { command = {} }
    check("native adapter rejects empty commands", not pcall(function()
        Operation.Resolve(copy, context)
    end))
end
do
    local c = table.clone(context)
    c.requested = "review"
    check("caller may explicitly choose a permitted PR operation", Operation.Resolve(cfg, c).name == "review")
    check("explicit callers do not require a trigger map", Operation.Resolve({ version = 1, operations = cfg.operations }, c).name == "review")
    rejects("operation is required", function()
        local missing = table.clone(c)
        missing.requested = ""
        Operation.Resolve(cfg, missing)
    end)
    rejects("obsolete trigger catalog rejected", function()
        Operation.Resolve({ version = 1, operations = cfg.operations, triggers = { pull_request = "review" } }, c)
    end)
    local operation = {
        mode = "protected", events = { "repository_dispatch", "pull_request_target" },
        actions = { "retire", "closed" }, environment = "maintenance", components = { "maintenance/*" },
    }
    local copy = table.clone(cfg)
    local operations = table.clone(cfg.operations)
    operations.maintenance = operation
    copy.operations = operations
    local remote = { event = "repository_dispatch", action = "retire", ref = "refs/heads/main",
        defaultBranch = "main", requested = "maintenance", confirmPublish = false }
    check("remote caller selects a protected operation", Operation.Resolve(copy, remote).mode == "protected")
    local close = table.clone(remote)
    close.event = "pull_request_target"
    close.action = "closed"
    check("protected close uses the ordinary operation resolver", Operation.Resolve(copy, close).name == "maintenance")
    rejects("unknown event action", function()
        local invalid = table.clone(remote)
        invalid.action = "unknown"
        Operation.Resolve(copy, invalid)
    end)
    rejects("protected operation from non-default branch", function()
        local invalid = table.clone(remote)
        invalid.ref = "refs/heads/topic"
        Operation.Resolve(copy, invalid)
    end)
    rejects("protected operation from an untrusted PR", function()
        local invalid = table.clone(remote)
        invalid.event = "pull_request"
        Operation.Resolve(copy, invalid)
    end)
end
do
    local c: any = table.clone(manual)
    c.ref = "refs/heads/topic"
    c.localExecution = true
    check("local build permits a feature checkout", Operation.Resolve(cfg, c).mode == "generated")
    c.requested = "publish"
    c.confirmPublish = true
    rejects("local publication is refused regardless of confirmation", function()
        Operation.Resolve(cfg, c)
    end)
end
print("CI Engine: " .. passed .. " operation routing tests passed")
