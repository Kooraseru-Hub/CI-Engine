--!strict
-- Resolve project-owned operations in an unprivileged GitHub Actions job.
-- A generated operation is never authorized solely by a requested name.
local Operation = {}

local function fail(message: string): never
    error("CI Engine: " .. message, 0)
end

local function list(value: any, where: string): { string }
    if type(value) ~= "table" then fail(where .. " must be an array") end
    local result: { string } = {}
    local seen: { [string]: boolean } = {}
    local count = 0
    local maximum = 0
    for key, item in value do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0
            or type(item) ~= "string" or item == "" or item:find("[%z\r\n]")
            or seen[item] then
            fail(where .. " must be a dense array of unique nonempty strings")
        end
        seen[item] = true
        result[key] = item
        count += 1
        maximum = math.max(maximum, key)
    end
    if count ~= maximum then fail(where .. " is not dense") end
    return result
end

function Operation.Resolve(config: any, context: {
    event: string, ref: string, defaultBranch: string, requested: string, confirmPublish: boolean, action: string?, localExecution: boolean?,
}): any
    if type(config) ~= "table" or config.version ~= 1 then
        fail("unsupported engine configuration version")
    end
    if type(config.operations) ~= "table" then fail("missing operations") end
    if config.triggers ~= nil then fail("event routing belongs to the caller, not the operation catalog") end
    local name = context.requested
    if type(name) ~= "string" or not name:match("^[a-z][a-z0-9-]*$") then
        fail("no configured operation for event " .. context.event)
    end
    local operation = config.operations[name]
    if type(operation) ~= "table" then fail("unknown operation: " .. name) end
    if not table.find(list(operation.events, name .. ".events"), context.event) then
        fail("operation " .. name .. " is unavailable on " .. context.event)
    end
    if operation.actions ~= nil and not table.find(list(operation.actions, name .. ".actions"), context.action or "") then
        fail("operation " .. name .. " is unavailable for event action " .. (context.action or ""))
    end
    if operation.mode ~= "readonly" and operation.mode ~= "generated" and operation.mode ~= "protected" then
        fail("unsupported operation mode: " .. name)
    end
    if operation.mode == "generated" then
        if context.event == "pull_request" or (context.event ~= "push" and context.event ~= "workflow_dispatch") then
            fail("untrusted events cannot run generated work")
        end
        if context.localExecution then
            if operation.publication == true then fail("publication is unavailable locally") end
        elseif context.defaultBranch == "" or context.ref ~= "refs/heads/" .. context.defaultBranch then
            fail("generated work requires the repository's default branch")
        end
        if operation.publication == true and context.event == "workflow_dispatch" and not context.confirmPublish then
            fail("manual publication requires explicit confirmation")
        end
        if type(operation.execution) ~= "table" then fail("generated operation has no execution adapter") end
        local command = list(operation.execution.command, name .. ".execution.command")
        if #command == 0 then fail("generated adapter requires an executable") end
        if type(operation.environment) ~= "string"
            or not operation.environment:match("^[a-zA-Z][a-zA-Z0-9_-]*$") then
            fail("generated operation requires a valid protected environment")
        end
        if type(operation.plan) ~= "string" or not operation.plan:match("^[a-zA-Z][a-zA-Z0-9_-]*$") then
            fail("generated operation requires an execution plan")
        end
        if type(operation.branchPrefix) ~= "string"
            or not operation.branchPrefix:match("^[a-zA-Z0-9][a-zA-Z0-9/-]*-$")
            or operation.branchPrefix:find("%.%.") or operation.branchPrefix:find("//", 1, true) then
            fail("invalid generated branch prefix")
        end
    elseif operation.mode == "protected" then
        if context.localExecution then fail("protected work is unavailable locally") end
        if context.event == "pull_request" or context.defaultBranch == ""
            or context.ref ~= "refs/heads/" .. context.defaultBranch then
            fail("protected work requires a trusted default-branch event")
        end
        if operation.execution ~= nil or operation.native ~= nil then
            fail("protected components cannot request another execution adapter")
        end
        if type(operation.environment) ~= "string"
            or not operation.environment:match("^[a-zA-Z][a-zA-Z0-9_-]*$") then
            fail("protected operation requires a valid environment")
        end
        if #list(operation.components, name .. ".components") == 0 then
            fail("protected operation selects no components")
        end
        if operation.publication == true and context.event == "workflow_dispatch" and not context.confirmPublish then
            fail("manual publication requires explicit confirmation")
        end
    else
        if operation.publication == true or operation.execution ~= nil then
            fail("read-only operation cannot request generated execution or publication")
        end
        local patterns = list(operation.components, name .. ".components")
        if #patterns == 0 then fail("read-only operation selects no components") end
        if operation.native ~= nil then
            if type(operation.native) ~= "table" then fail("native adapter must be a record") end
            if #list(operation.native.command, name .. ".native.command") == 0 then
                fail("native adapter requires an executable")
            end
        end
    end
    return { name = name, mode = operation.mode, environment = operation.environment or "",
        publication = operation.publication == true, plan = operation.plan or "",
        branchPrefix = operation.branchPrefix or "", operation = operation }
end

function Operation.Context(env: { [string]: string }): any
    return {
        event = env.GITHUB_EVENT_NAME or "workflow_dispatch",
        action = env.CI_EVENT_ACTION or "",
        ref = env.GITHUB_REF or "",
        defaultBranch = env.CI_DEFAULT_BRANCH or "",
        requested = env.CI_REQUESTED_OPERATION or "",
        confirmPublish = env.CI_REQUESTED_PUBLISH == "true",
        localExecution = env.ACT == "true",
    }
end

return Operation
