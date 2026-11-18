--!strict
-- Execute validated component plans with scoped credential bindings.

local Fs = require("@std/fs")
local Process = require("@lute/process")
local Glob = require("@engine/planning/glob")
local Outcome = require("@engine/execution/outcome")
local Json = require("@engine/configuration/json")

local Components = {}

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

local function bindings(raw: string?): { [string]: string }
    if not raw or raw == "" then return {} end
    local ok, decoded = pcall(Json.decode, raw)
    if not ok or type(decoded) ~= "table" then fail("invalid component binding object") end
    local result: { [string]: string } = {}
    for name, value in decoded do
        if type(name) ~= "string" or not name:match("^[a-z][a-z0-9_]*$")
            or type(value) ~= "string" or value == "" or value:find("[%z]") then
            fail("invalid component binding")
        end
        result[name] = value
    end
    return result
end

local function mask(value: string): ()
    local escaped = value:gsub("%%", "%%25"):gsub("\r", "%%0D"):gsub("\n", "%%0A")
    print("::add-mask::" .. escaped)
end

function Components.Run(ordered: { string }, components: { [string]: any }, protected: boolean?): ()
    local secrets = if protected then bindings(Process.env.CI_COMPONENT_CREDENTIALS) else {}
    local variables = if protected then bindings(Process.env.CI_COMPONENT_VARIABLES) else {}
    if protected and Process.env.CI_COMPONENT_GITHUB_TOKEN and Process.env.CI_COMPONENT_GITHUB_TOKEN ~= "" then
        secrets.gh_token = Process.env.CI_COMPONENT_GITHUB_TOKEN
    end
    for _, value in secrets do mask(value) end
    for _, identity in ordered do
        local component = components[identity]
        if not protected and (component.boundary ~= "read" or #component.credentials > 0) then
            fail("privileged work is unavailable in read-only executor: " .. identity)
        end
        local command = component.command
        if not command then
            fail(identity .. ": a module-backed component requires an explicit execution adapter")
        end
        local environment = table.clone(Process.env)
        environment.GITHUB_EVENT_NAME = Process.env.CI_ORIGIN_EVENT or Process.env.GITHUB_EVENT_NAME
        environment.GITHUB_REF = Process.env.CI_ORIGIN_REF or Process.env.GITHUB_REF
        environment.GITHUB_SHA = Process.env.CI_ORIGIN_SHA or Process.env.GITHUB_SHA
        environment.GH_TOKEN = ""
        environment.GITHUB_TOKEN = ""
        -- A universal execution job may have OIDC permission for its trusted
        -- lane; never expose the token vending endpoints to project commands.
        environment.ACTIONS_ID_TOKEN_REQUEST_URL = ""
        environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN = ""
        environment.CI_CREDENTIAL_APP_PRIVATE_KEY = ""
        environment.CI_CREDENTIAL_BOOTSTRAP_TOKEN = ""
        environment.CI_COMPONENT_CREDENTIALS = ""
        environment.CI_COMPONENT_VARIABLES = ""
        environment.CI_COMPONENT_GITHUB_TOKEN = ""
        if protected and component.boundary == "privileged" then
            for _, name in component.credentials do
                local value = secrets[name] or variables[name]
                if not value then fail(identity .. ": missing credential " .. name) end
                environment[string.upper(name)] = value
            end
        end
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

return Components
