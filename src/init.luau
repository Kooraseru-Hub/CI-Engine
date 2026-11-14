--!strict
-- Portable bootstrap. No repo-specific code, application secrets, or Node controller.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@std/json")

type Record = { [string]: any }

local function fail(message: string): never
    error("CI Engine: " .. message, 0)
end

local function record(value: any, where: string): Record
    if type(value) ~= "table" then fail(where .. " must be a table") end
    return value :: Record
end

local function strings(value: any, where: string): { string }
    if type(value) ~= "table" then fail(where .. " must be an array") end
    local result: { string } = {}
    for i, item in value do
        if type(i) ~= "number" or i % 1 ~= 0 or i < 1 or type(item) ~= "string" or item == "" then
            fail(where .. " must be an array of nonempty strings")
        end
        result[i] = item
    end
    for i = 1, #result do
        if not result[i] then fail(where .. " must be dense") end
    end
    return result
end

local function unique(items: { string }): { string }
    local found: { [string]: boolean } = {}
    local out: { string } = {}
    for _, item in items do
        if not found[item] then
            found[item] = true
            table.insert(out, item)
        end
    end
    table.sort(out)
    return out
end

local function selected(identity: string, patterns: { string }): boolean
    for _, pattern in patterns do
        if pattern == "*" or pattern == identity then return true end
        if pattern:sub(-2) == "/*" and identity:sub(1, #pattern - 1) == pattern:sub(1, -2) then
            return true
        end
    end
    return false
end

local function run(command: { string }, environment: { [string]: string }?): ()
    local options: Process.ProcessRunOptions = {
        cwd = Process.cwd(),
        stdio = "inherit",
        env = environment or Process.env,
    }
    local result = Process.run(command, options)
    if not result.ok then fail("command failed (" .. tostring(result.exitcode) .. "): " .. command[1]) end
end

local function load(path: string): Record
    if not Fs.exists(path) then fail("missing configuration: " .. path) end
    local ok, result = pcall(function()
        return Json.deserialize(Fs.readFileToString(path))
    end)
    if not ok then fail("invalid JSON in " .. path .. ": " .. tostring(result)) end
    return record(result, path)
end

local function discover(root: string): { [string]: Record }
    if not root:match("^[%w_./-]+$") or root:sub(1, 1) == "/" or root:find("%.%.") then
        fail("unsafe component root")
    end
    local listing = Process.run({ "git", "ls-files", "--stage", "--", root }, { cwd = Process.cwd() })
    if not listing.ok then fail("unable to inspect tracked components") end
    local found: { [string]: Record } = {}
    for line in listing.stdout:gmatch("[^\r\n]+") do
        local mode, path = line:match("^(%d+)%s+[%da-fA-F]+%s+%d+\t(.+)$")
        if not mode or not path then fail("invalid git index entry") end
        if mode == "120000" or mode == "160000" then fail("linked component entry: " .. path) end
        if path:sub(-15) == "/component.json" then
            local identity = path:sub(#root + 2, -16)
            if identity == "" or not identity:match("^[%w_/-]+$") or identity:find("%.%.") then
                fail("unsafe component identity: " .. identity)
            end
            if found[identity] then fail("duplicate component: " .. identity) end
            local component = load(path)
            local boundary = component.boundary or "read"
            if boundary ~= "read" and boundary ~= "privileged" then fail(identity .. ": invalid boundary") end
            component.boundary = boundary
            component.requires = strings(component.requires or {}, identity .. ".requires")
            component.provides = strings(component.provides or {}, identity .. ".provides")
            component.events = strings(component.events or {}, identity .. ".events")
            if component.command ~= nil then
                component.command = strings(component.command, identity .. ".command")
                if #component.command == 0 then fail(identity .. ": empty command") end
            end
            found[identity] = component
        end
    end
    return found
end

local function main(): ()
    local configPath = Process.env.CI_ENGINE_CONFIG or ".github/config/ci/engine.json"
    local config = load(configPath)
    local event = Process.env.GITHUB_EVENT_NAME or "workflow_dispatch"
    local routes = record(config.triggers, "triggers")
    local requested = Process.env.CI_REQUESTED_OPERATION or ""
    if requested ~= "" and event ~= "workflow_dispatch" then fail("operation override requires workflow_dispatch") end
    local name = if requested ~= "" then requested else routes[event]
    if type(name) ~= "string" or name == "" then fail("no configured operation for event " .. event) end
    local operations = record(config.operations, "operations")
    local operation = record(operations[name], "operations." .. name)
    local events = strings(operation.events or {}, "operation.events")
    if not table.find(events, event) then fail("operation " .. name .. " is not authorized for " .. event) end
    if event == "push" and operation.branch == "default" then
        local defaultBranch = Process.env.CI_DEFAULT_BRANCH
        if not defaultBranch or defaultBranch == "" then fail("missing default branch event context") end
        if Process.env.GITHUB_REF ~= "refs/heads/" .. defaultBranch then
            print("CI Engine: non-default branch push excluded by operation policy")
            return
        end
    end
    if operation.mode ~= "readonly" then fail("operation " .. name .. " requires an isolated privileged backend; refusing execution") end
    local patterns = strings(operation.components or {}, "operation.components")
    if #patterns == 0 then fail("operation " .. name .. " selects no components") end

    local components = discover(config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or "ci/components")
    local active: { [string]: Record } = {}
    local providers: { [string]: string } = {}
    for identity, component in components do
        if selected(identity, patterns) and component.enabled ~= false
            and (#component.events == 0 or table.find(component.events, event)) then
            if component.boundary ~= "read" or #(component.credentials or {}) > 0 then
                fail("privileged component selected by read-only operation: " .. identity)
            end
            active[identity] = component
            for _, capability in component.provides do
                if providers[capability] then fail("ambiguous capability " .. capability) end
                providers[capability] = identity
            end
        end
    end

    local visiting: { [string]: boolean } = {}
    local done: { [string]: boolean } = {}
    local ordered: { string } = {}
    local function visit(identity: string): ()
        if visiting[identity] then fail("dependency cycle at " .. identity) end
        if done[identity] then return end
        local component = active[identity]
        if not component then fail("missing selected component " .. identity) end
        visiting[identity] = true
        for _, capability in unique(component.requires) do
            local dependency = providers[capability]
            if not dependency then fail(identity .. " requires unavailable capability " .. capability) end
            visit(dependency)
        end
        visiting[identity] = nil
        done[identity] = true
        table.insert(ordered, identity)
    end
    local names: { string } = {}
    for identity in active do table.insert(names, identity) end
    table.sort(names)
    for _, identity in names do visit(identity) end

    print("CI Engine: " .. name .. " (" .. event .. "), " .. #ordered .. " component(s)")
    for _, identity in ordered do
        local component = active[identity]
        local command = component.command
        if not command then
            fail(identity .. ": module-backed components require an explicit adapter; refusing fallback")
        end
        local environment = table.clone(Process.env)
        environment.GH_TOKEN = ""
        environment.GITHUB_TOKEN = ""
        print("::group::" .. identity)
        run(command, environment)
        print("::endgroup::")
    end
    print("CI Engine: operation completed successfully")
end

main()
