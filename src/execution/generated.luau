--!strict
-- Generic adapter invocation. A project may implement a native GitHub workflow
-- generator, local tools, or any other executor behind this explicit command.
-- The engine owns the trust gate, environment selection and result propagation.
local Process = require("@lute/process")
local Generated = {}

function Generated.Run(route: any, context: any): ()
    if route.mode ~= "generated" then
        error("CI Engine: generated executor cannot run a read-only operation", 0)
    end
    local localExecution = Process.env.ACT == "true"
    if localExecution and route.publication then
        error("CI Engine: publication is unavailable locally", 0)
    end
    if not localExecution and (Process.env.GITHUB_ACTIONS ~= "true"
        or context.event == "pull_request"
        or context.defaultBranch == ""
        or context.ref ~= "refs/heads/" .. context.defaultBranch) then
        error("CI Engine: privileged adapter requires a trusted default-branch GitHub run", 0)
    end
    local operation = route.operation
    local command = operation.execution.command
    local environment = table.clone(Process.env)
    environment.GITHUB_EVENT_NAME = context.event
    environment.GITHUB_REF = context.ref
    environment.GITHUB_SHA = Process.env.CI_ORIGIN_SHA or Process.env.GITHUB_SHA
    environment.CI_EVENT = context.event
    if localExecution then
        for name in environment do
            if name == "GH_TOKEN" or name == "GITHUB_TOKEN" or name:sub(1, 14) == "CI_CREDENTIAL_" or name:sub(1, 17) == "ACTIONS_ID_TOKEN_" then
                environment[name] = ""
            end
        end
    end
    environment.CI_OPERATION = route.plan
    environment.CI_PROFILE = operation.execution.profile or "source-ci"
    environment.CI_PUBLICATION_ENABLED = if route.publication then "true" else "false"
    environment.CI_EXECUTION_PREFIX = route.branchPrefix
    environment.CI_ENGINE_OPERATION = route.name
    local expected = Process.env.CI_ENGINE_SELECTED_OPERATION
    if expected and expected ~= "" and expected ~= route.name then
        error("CI Engine: resolved operation changed between jobs", 0)
    end
    print("::group::CI Engine generated adapter")
    local ok, result = pcall(Process.run, command, {
        cwd = Process.cwd(), stdio = "inherit", env = environment,
    })
    if not ok then error("CI Engine: generated adapter could not start: " .. tostring(result), 0) end
    if not result.ok then
        error("CI Engine: generated adapter failed (" .. tostring(result.exitcode) .. ")", 0)
    end
    print("::endgroup::")
end
return Generated
