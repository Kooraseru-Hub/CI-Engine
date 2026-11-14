--!strict
-- Generic CI entry point. Project configuration owns operations, not this file.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@engine/configuration/json")
local Component = require("@engine/contracts/component")
local Discovery = require("@engine/discovery/components")
local Graph = require("@engine/planning/graph")
local ReadOnly = require("@engine/execution/readonly")

type Record = { [string]: any }

local function fail(message: string): never
    error("CI Engine: " .. message, 0)
end

local function record(value: any, where: string): Record
    if type(value) ~= "table" then fail(where .. " must be an object") end
    return value :: Record
end

local function strings(value: any, where: string): { string }
    if type(value) ~= "table" then fail(where .. " must be an array") end
    local entries: { string } = {}
    local count = 0
    local max = 0
    local seen: { [string]: boolean } = {}
    for index, item in value do
        if type(index) ~= "number" or index < 1 or index % 1 ~= 0
            or type(item) ~= "string" or item == "" or item:find("[%z\r\n]") then
            fail(where .. " must be an array of nonempty strings")
        end
        if seen[item] then fail(where .. " contains duplicate " .. item) end
        seen[item] = true
        entries[index] = item
        count += 1
        max = math.max(max, index)
    end
    if max ~= count then fail(where .. " must be a contiguous array") end
    return entries
end

local function load(path: string): Record
    if not Component.ValidRoot(path) or not Fs.exists(path) then
        fail("missing or unsafe configuration: " .. path)
    end
    local ok, value = pcall(function()
        return Json.deserialize(Fs.readFileToString(path))
    end)
    if not ok then fail("invalid JSON in " .. path .. ": " .. tostring(value)) end
    return record(value, path)
end

local function main(): ()
    local config = load(Process.env.CI_ENGINE_CONFIG or ".github/config/ci/engine.json")
    if config.version ~= 1 then fail("unsupported engine configuration version") end
    local event = Process.env.GITHUB_EVENT_NAME or "workflow_dispatch"
    local routes = record(config.triggers, "triggers")
    local requested = Process.env.CI_REQUESTED_OPERATION or ""
    if requested ~= "" and event ~= "workflow_dispatch" then
        fail("operation override requires workflow_dispatch")
    end
    local name = if requested ~= "" then requested else routes[event]
    if type(name) ~= "string" or name == "" then
        fail("no configured operation for event " .. event)
    end
    local operations = record(config.operations, "operations")
    local operation = record(operations[name], "operations." .. name)
    local events = strings(operation.events or {}, "operation.events")
    if not table.find(events, event) then
        fail("operation " .. name .. " is not authorized for " .. event)
    end
    if event == "push" and operation.branch == "default" then
        local default = Process.env.CI_DEFAULT_BRANCH
        if not default or default == "" then fail("missing default branch event context") end
        if Process.env.GITHUB_REF ~= "refs/heads/" .. default then
            print("CI Engine: non-default branch push excluded by operation policy")
            return
        end
    end
    if operation.mode ~= "readonly" then
        fail("operation " .. name .. " requires an isolated backend; refusing execution")
    end
    local patterns = strings(operation.components or {}, "operation.components")
    if #patterns == 0 then fail("operation " .. name .. " selects no components") end
    local root = config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or "ci/components"
    if type(root) ~= "string" or not Component.ValidRoot(root) then
        fail("unsafe component root")
    end
    local components = Discovery.Load(root)
    local plan = Graph.Plan(components, patterns, event, operation.mode)
    print("CI Engine: " .. name .. " (" .. event .. "), " .. #plan.ordered .. " component(s)")
    ReadOnly.Run(plan.ordered, components)
    print("CI Engine: operation completed successfully")
end

main()
