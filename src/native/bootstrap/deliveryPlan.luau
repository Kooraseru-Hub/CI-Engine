--!strict
-- Select native publication jobs from the same validated component plan as Build.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@formats/json")
local Bootstrap = require("@ci/bootstrap")
local Configuration = require("@ci/github/configuration")
local Workflow = require("@ci/github/workflows/workflow")
local NativeJob = require("@ci/github/workflows/nativeJob")
local Artifacts = require("@ci/github/workflows/artifacts")
local tasks = Bootstrap.Plan("push")
local configuration = Configuration.new()
local profile = configuration.profiles["source-ci"]
local jobs: { any } = {}
local phases: { [string]: string } = {}
for _, task in tasks do phases[task.identity] = task.phase end
local loader = { "node", "dependencies/packages/core/dependencyLoader/index.ts", "--exec", "tools.ciEngine", "native" }
for _, task in tasks do
    if task.phase ~= "publish" then continue end
    for _, dependency in task.needs do
        if phases[dependency] ~= "build" then error("Publication jobs may consume only verified build inputs: " .. task.identity, 0) end
    end
    local native: { [string]: any } = { permissions = { contents = if #task.credentials > 0 then "read" else "write", actions = "read" } }
    local steps: { NativeJob.Step } = {}
    NativeJob.Configure(task.identity, task.boundary, steps, native)
    local perms = native.permissions
    local lane = if perms.pages == "write" then "pages" elseif perms.issues == "write" then "issues" elseif perms.contents == "write" then "contents" else "credential"
    local allowed: { [string]: string } = { contents = if lane == "contents" then "write" else "read", actions = "read" }
    if lane == "pages" then allowed.pages = "write"; allowed["id-token"] = "write" end
    if lane == "issues" then allowed.issues = "write" end
    for name, level in perms do
        if level ~= "none" and not (allowed[name] == level or (allowed[name] == "write" and level == "read")) then
            error("Unsupported publication permission lane: " .. task.identity .. " / " .. name, 0)
        end
    end
    local environment = if #task.credentials > 0 then Workflow.ComponentEnvironment(configuration, profile, task) else "ci-publication"
    if native.environment then
        if #task.credentials > 0 then error("Conflicting component credential environment", 0) end
        environment = native.environment.name
    end
    local command = table.clone(loader)
    table.insert(command, "--component")
    table.insert(command, task.identity)
    local item: any = { id = task.identity, lane = lane, environment = environment, command = command }
    if #task.credentials > 0 then
        local bindings = {}
        for _, role in task.credentials do
            local alias = configuration.environments[environment][role]
            local source, name = alias:match("^(%a+)%.([%w_]+)$")
            if source ~= "secrets" and source ~= "vars" then error("Unsupported credential binding: " .. role, 0) end
            table.insert(bindings, { role = "CI_CREDENTIAL_" .. role:upper(), source = if source == "secrets" then "secret" else "variable", name = name })
        end
        item.bindings = bindings
    end
    if lane == "pages" then
        if #steps ~= 3 or steps[1].run ~= table.concat(loader, " ") .. " --pages-options"
            or steps[2].uses ~= "actions/upload-pages-artifact@v4" or steps[3].uses ~= "actions/deploy-pages@v4"
            or not steps[2].with or type(steps[2].with.path) ~= "string" then error("Unsupported native Pages adapter", 0) end
        local options = table.clone(loader)
        table.insert(options, "--pages-options")
        item.options_command = options
        item.pages_path = steps[2].with.path
    elseif #steps ~= 0 then
        error("Native steps require an explicit supported permission adapter: " .. task.identity, 0)
    end
    table.insert(jobs, item)
end
local plan = Json.encode({ artifact = Artifacts.Transport(), destination = Artifacts.Transport(), jobs = jobs })
local file = Process.env.CI_DELIVERY_PLAN_FILE
if file then Fs.writeStringToFile(file, plan) else print(plan) end
