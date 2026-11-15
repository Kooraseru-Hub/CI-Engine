--!strict
-- Adapted from Template PR #43's executor: only the unprivileged
-- backend lives here. A privileged backend must independently authorize work.

local Fs = require("@std/fs")
local Process = require("@lute/process")
local Glob = require("@engine/planning/glob")
local Outcome = require("@engine/execution/outcome")

local ReadOnly = {}

local function fail(message: string): never
    error("CI Engine: " .. message, 0)
end

local function missingOutputs(outputs: { string }): { string }
    local missing: { string } = {}
    for _, pattern in outputs do
        if pattern:find("*", 1, true) or pattern:find("?", 1, true) then
            if #Glob.Find(pattern) == 0 then table.insert(missing, pattern) end
        elseif not Fs.exists(pattern) then
            table.insert(missing, pattern)
        end
    end
    return missing
end

function ReadOnly.Run(ordered: { string }, components: { [string]: any }): ()
    for _, identity in ordered do
        local component = components[identity]
        if component.boundary ~= "read" or #component.credentials > 0 then
            fail("privileged work is unavailable in read-only executor: " .. identity)
        end
        local command = component.command
        if not command then
            fail(identity .. ": a module-backed component requires an explicit execution adapter")
        end
        local environment = table.clone(Process.env)
        environment.GH_TOKEN = ""
        environment.GITHUB_TOKEN = ""
        -- A universal execution job may have OIDC permission for its trusted
        -- lane; never expose the token vending endpoints to project commands.
        environment.ACTIONS_ID_TOKEN_REQUEST_URL = ""
        environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN = ""
        environment.CI_CREDENTIAL_APP_PRIVATE_KEY = ""
        environment.CI_CREDENTIAL_BOOTSTRAP_TOKEN = ""
        environment.CI_COMPONENT = identity
        print("::group::" .. identity)
        local ok, result = pcall(Process.run, command, {
            cwd = Process.cwd(), stdio = "inherit", env = environment,
        })
        if not ok then fail(identity .. ": cannot start component: " .. tostring(result)) end
        local outcome = Outcome.FromExitCode(result.exitcode)
        if outcome == "skipped" then
            -- Skip policy/reporting has not been extracted; don't mark missing
            -- execution as success without the consumer explicitly opting in.
            fail(identity .. ": skipped without a configured skip policy")
        end
        if outcome ~= "passed" then
            fail(identity .. ": command failed (" .. tostring(result.exitcode) .. "): " .. command[1])
        end
        local missing = missingOutputs(component.outputs)
        if #missing > 0 then
            fail(identity .. ": missing declared outputs: " .. table.concat(missing, ", "))
        end
        print("::endgroup::")
    end
end

return ReadOnly
