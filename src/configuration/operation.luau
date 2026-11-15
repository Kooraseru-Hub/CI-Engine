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
    event: string, ref: string, defaultBranch: string, requested: string, confirmPublish: boolean,
}): any
    if type(config) ~= "table" or config.version ~= 1 then
        fail("unsupported engine configuration version")
    end
    if type(config.triggers) ~= "table" or type(config.operations) ~= "table" then
        fail("missing triggers or operations")
    end
    local name = if context.requested ~= "" then context.requested else config.triggers[context.event]
    if context.requested ~= "" and context.event ~= "workflow_dispatch" then
        fail("operation override requires workflow_dispatch")
    end
    if type(name) ~= "string" or not name:match("^[a-z][a-z0-9-]*$") then
        fail("no configured operation for event " .. context.event)
    end
    local operation = config.operations[name]
    if type(operation) ~= "table" then fail("unknown operation: " .. name) end
    if not table.find(list(operation.events, name .. ".events"), context.event) then
        fail("operation " .. name .. " is unavailable on " .. context.event)
    end
    if operation.mode ~= "readonly" and operation.mode ~= "generated" then
        fail("unsupported operation mode: " .. name)
    end
    if operation.mode == "generated" then
        if context.event == "pull_request" or (context.event ~= "push" and context.event ~= "workflow_dispatch") then
            fail("untrusted events cannot run generated work")
        end
        if context.defaultBranch == "" or context.ref ~= "refs/heads/" .. context.defaultBranch then
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
    else
        if operation.publication == true or operation.execution ~= nil then
            fail("read-only operation cannot request generated execution or publication")
        end
        local patterns = list(operation.components, name .. ".components")
        if #patterns == 0 then fail("read-only operation selects no components") end
    end
    return { name = name, mode = operation.mode, environment = operation.environment or "",
        publication = operation.publication == true, plan = operation.plan or "",
        branchPrefix = operation.branchPrefix or "", operation = operation }
end

function Operation.Context(env: { [string]: string }): any
    return {
        event = env.GITHUB_EVENT_NAME or "workflow_dispatch",
        ref = env.GITHUB_REF or "",
        defaultBranch = env.CI_DEFAULT_BRANCH or "",
        requested = env.CI_REQUESTED_OPERATION or "",
        confirmPublish = env.CI_REQUESTED_PUBLISH == "true",
    }
end

return Operation
