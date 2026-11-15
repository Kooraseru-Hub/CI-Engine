--!strict
-- Stable, language-neutral entry point for independently reusable engine stages.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@engine/configuration/json")
local Component = require("@engine/contracts/component")
local Discovery = require("@engine/discovery/components")
local Graph = require("@engine/planning/graph")
local ReadOnly = require("@engine/execution/readonly")
local Operation = require("@engine/configuration/operation")
local Generated = require("@engine/execution/generated")

local function fail(message: string): never
    error("CI Engine: " .. message, 0)
end

local function load(path: string): any
    if not Component.ValidRoot(path) or not Fs.exists(path) then
        fail("missing or unsafe configuration: " .. path)
    end
    local ok, value = pcall(function()
        return Json.decode(Fs.readFileToString(path))
    end)
    if not ok or type(value) ~= "table" then
        fail("invalid JSON object in " .. path)
    end
    return value
end

local function writeOutput(name: string, value: string): ()
    local path = Process.env.GITHUB_OUTPUT
    if not path or path == "" then fail("resolve requires GITHUB_OUTPUT") end
    if name:find("[^%w_]") or value:find("[\r\n]") then fail("unsafe workflow output") end
    local current = if Fs.exists(path) then Fs.readFileToString(path) else ""
    local delimiter = if current ~= "" and current:sub(-1) ~= "\n" then "\n" else ""
    Fs.writeStringToFile(path, current .. delimiter .. name .. "=" .. value .. "\n")
end

local function main(): ()
    local config = load(Process.env.CI_ENGINE_CONFIG or ".github/config/ci/engine.json")
    local context = Operation.Context(Process.env)
    local route = Operation.Resolve(config, context)
    local phase = Process.env.CI_ENGINE_PHASE or "execute"
    local expected = Process.env.CI_ENGINE_SELECTED_OPERATION
    if expected and expected ~= "" and expected ~= route.name then
        fail("operation selection changed after the resolve job")
    end

    if phase == "resolve" then
        writeOutput("operation", route.name)
        writeOutput("mode", route.mode)
        writeOutput("environment", route.environment)
        writeOutput("plan", route.plan)
        writeOutput("publication", if route.publication then "true" else "false")
        writeOutput("branch_prefix", route.branchPrefix)
        print("CI Engine: " .. route.name .. " selected (" .. route.mode .. ")")
        return
    end
    if phase == "generated" then
        Generated.Run(route, context)
        print("CI Engine: generated operation completed successfully")
        return
    end
    if phase ~= "execute" then fail("unknown engine phase: " .. phase) end
    if route.mode ~= "readonly" then fail("privileged work cannot run in read-only executor") end

    local root = config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or "ci/components"
    if type(root) ~= "string" or not Component.ValidRoot(root) then fail("unsafe component root") end
    local components = Discovery.Load(root)
    local plan = Graph.Plan(components, route.operation.components, context.event, route.mode)
    print("CI Engine: " .. route.name .. " (" .. context.event .. "), " .. #plan.ordered .. " component(s)")
    ReadOnly.Run(plan.ordered, components)
    print("CI Engine: operation completed successfully")
end

main()
