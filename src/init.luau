--!strict
-- Stable, language-neutral entry point for independently reusable engine stages.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@engine/configuration/json")
local Component = require("@engine/contracts/component")
local Discovery = require("@engine/discovery/components")
local Graph = require("@engine/planning/graph")
local Components = require("@engine/execution/components")
local Operation = require("@engine/configuration/operation")
local HostTests = require("@engine/planning/hostTests")

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
    local phase = Process.env.CI_ENGINE_PHASE or "execute"
    local config = load("config/ci/operations.json")
    local context = Operation.Context(Process.env)
    local route = Operation.Resolve(config, context)
    local expected = Process.env.CI_ENGINE_SELECTED_OPERATION
    if expected and expected ~= "" and expected ~= route.name then
        fail("operation selection changed after the resolve job")
    end

    if phase == "resolve" then
        writeOutput("operation", route.name)
        writeOutput("mode", route.mode)
        writeOutput("environment", route.environment)
        writeOutput("publication", if route.publication then "true" else "false")
        print("CI Engine: " .. route.name .. " selected (" .. route.mode .. ")")
        return
    end
    if phase == "prepare" then
        local result = Process.run({ "git", "rev-parse", "--is-inside-work-tree" }, { cwd = Process.cwd() })
        if not result.ok or not result.stdout:find("true", 1, true) then
            fail("prepare requires a Git working tree")
        end
        print("CI Engine: workspace prepared for " .. route.name)
        print("CI Engine: project tool dependencies remain component-owned")
        return
    end
    if phase == "inspect" then
        -- Independent of component discovery. Verify the selected execution
        -- boundary and repository event context before authorization.
        local root = config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or ".github/components"
            if type(root) ~= "string" or not Component.ValidRoot(root) then
                fail("unsafe read-only component root")
            end
            if route.mode == "readonly" and (route.operation.publication == true or route.operation.execution ~= nil) then
                fail("read-only operation cannot request privileged execution")
            end
            print("CI Engine: inspected " .. route.mode .. " policy and safe component root")
        return
    end
    if phase == "plan" then
        local enabled, matrix, artifact = HostTests.Plan(route.operation.hostTests, context.localExecution)
        writeOutput("host_tests", enabled)
        writeOutput("host_matrix", matrix)
        writeOutput("host_artifact", artifact)
    end
    if phase == "discover" or phase == "plan" then
            local root = config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or ".github/components"
            if type(root) ~= "string" or not Component.ValidRoot(root) then fail("unsafe component root") end
            local components = Discovery.Load(root)
            if phase == "discover" then
                local count = 0
                for _ in components do count += 1 end
                if count == 0 then fail("no component contracts discovered") end
                print("CI Engine: discovered " .. count .. " tracked component contracts")
            else
                local plan = Graph.Plan(components, route.operation.components, context.event, if route.mode == "staged" then "readonly" else route.mode)
                if #plan.ordered == 0 then fail("no components selected by " .. route.name) end
                print("CI Engine: execution plan (" .. #plan.ordered .. " components)")
                for position, identity in plan.ordered do
                    print(position .. ". " .. identity)
                end
            end
        return
    end
    if phase == "authorize" then
        writeOutput("mode", route.mode)
        writeOutput("environment", route.environment)
        writeOutput("operation", route.name)
        if route.mode ~= "readonly" then
            if not context.localExecution and Process.env.CI_ORIGIN_TRUSTED ~= "true" then fail("privileged work requires trusted admission") end
            if not context.localExecution and (context.event == "pull_request" or context.ref ~= "refs/heads/" .. context.defaultBranch) then
                fail("untrusted event cannot authorize privileged execution")
            end
            print("CI Engine: trusted execution authorized for environment " .. route.environment)
        else
            print("CI Engine: read-only execution authorized without publishing credentials")
        end
        return
    end
    if phase ~= "execute" and phase ~= "protected" then fail("unknown engine phase: " .. phase) end
    if phase == "protected" then
        if route.mode ~= "protected" or Process.env.ACT == "true" or Process.env.GITHUB_ACTIONS ~= "true"
            or context.defaultBranch == "" or context.ref ~= "refs/heads/" .. context.defaultBranch
            or context.event == "pull_request" then
            fail("protected execution requires a trusted hosted operation")
        end
    elseif route.mode ~= "readonly" and route.mode ~= "staged" then
        fail("privileged work cannot run in read-only executor")
    end

    local root = config.componentRoot or Process.env.CI_ENGINE_COMPONENT_ROOT or ".github/components"
    if type(root) ~= "string" or not Component.ValidRoot(root) then fail("unsafe component root") end
    local components = Discovery.Load(root)
    local plan = Graph.Plan(components, route.operation.components, context.event, if route.mode == "staged" then "readonly" else route.mode)
    print("CI Engine: " .. route.name .. " (" .. context.event .. "), " .. #plan.ordered .. " component(s)")
    Components.Run(plan.ordered, components, phase == "protected")
    print("CI Engine: operation completed successfully")
end

main()
