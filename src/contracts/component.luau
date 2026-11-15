--!strict
-- Adapted from Template PR #43: ci/bootstrap/contracts/contract.luau.
-- Component metadata is data, not executable code. Do not enumerate languages,
-- operations, supported events, or phase names in this contract.

local Component = {}

local function invalid(path: string, message: string): never
    error(path .. ": " .. message, 0)
end

-- Reject sparse arrays, duplicate entries, non-string keys, and control chars.
local function strings(path: string, field: string, source: any, pattern: string?): { string }
    if type(source) ~= "table" then
        invalid(path, field .. " must be an array")
    end
    local result: { string } = {}
    local seen: { [string]: boolean } = {}
    local count = 0
    local maximum = 0
    for key, value in source do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0
            or type(value) ~= "string" or value == "" or value:find("[%z\r\n]") then
            invalid(path, field .. " must be an array of nonempty strings without control characters")
        end
        if pattern and not value:match(pattern) then
            invalid(path, "invalid " .. field .. ": " .. value)
        end
        if seen[value] then
            invalid(path, "duplicate " .. field .. ": " .. value)
        end
        seen[value] = true
        result[key] = value
        count += 1
        maximum = math.max(maximum, key)
    end
    if count ~= maximum then
        invalid(path, field .. " must be a contiguous array")
    end
    return result
end

local function validRelativePath(path: string): boolean
    if path == "" or path:sub(1, 1) == "/" or path:sub(-1) == "/"
        or path:find("\\", 1, true) or path:find(":", 1, true)
        or path:find("//", 1, true) or path:find("[%z\r\n]") then
        return false
    end
    for part in path:gmatch("[^/]+") do
        if part == "." or part == ".." then
            return false
        end
    end
    return true
end

function Component.ValidIdentity(identity: string): boolean
    if not validRelativePath(identity) then
        return false
    end
    for segment in identity:gmatch("[^/]+") do
        if not segment:match("^[%a%d][%w_-]*$") then
            return false
        end
    end
    return true
end

function Component.ValidRoot(root: string): boolean
    if not validRelativePath(root) then
        return false
    end
    for segment in root:gmatch("[^/]+") do
        if not segment:match("^[%w_.-]+$") then
            return false
        end
    end
    return true
end

local function paths(path: string, field: string, value: any): { string }
    local entries = strings(path, field, value)
    for _, entry in entries do
        if not validRelativePath(entry) then
            invalid(path, "unsafe " .. field .. " glob: " .. entry)
        end
    end
    return entries
end

local allowed = {
    provides = true, requires = true, inputs = true, outputs = true,
    events = true, boundary = true, credentials = true, command = true,
    enabled = true, phase = true, extensions = true,
}

function Component.Validate(identity: string, path: string, value: any): { [string]: any }
    if not Component.ValidIdentity(identity) then
        invalid(path, "invalid component identity: " .. identity)
    end
    if type(value) ~= "table" then
        invalid(path, "component manifest must contain an object")
    end
    for key in value do
        if type(key) ~= "string" or not allowed[key] then
            invalid(path, "unknown component field: " .. tostring(key))
        end
    end
    local provides = strings(path, "provides", value.provides, "^[a-z][a-z0-9_.:-]*$")
    if #provides == 0 then invalid(path, "provides must not be empty") end
    local requires = strings(path, "requires", value.requires or {}, "^[a-z][a-z0-9_.:-]*$")
    local events = strings(path, "events", value.events or {}, "^[%w_.:-]+$")
    local credentials = strings(path, "credentials", value.credentials or {}, "^[a-z][a-z0-9_]*$")
    local inputs = paths(path, "inputs", value.inputs or {})
    local outputs = paths(path, "outputs", value.outputs or {})
    local boundary = value.boundary or "read"
    if boundary ~= "read" and boundary ~= "privileged" then
        invalid(path, "boundary must be read or privileged")
    end
    if boundary ~= "privileged" and #credentials > 0 then
        invalid(path, "credentials require a privileged boundary")
    end
    local command: { string }? = nil
    if value.command ~= nil then
        command = strings(path, "command", value.command)
        if #command == 0 then invalid(path, "command requires an executable") end
    end
    local enabled = value.enabled
    if enabled ~= nil and type(enabled) ~= "boolean" then
        invalid(path, "enabled must be boolean")
    end
    if value.phase ~= nil and (type(value.phase) ~= "string" or value.phase == "") then
        invalid(path, "phase must be a nonempty string")
    end
    if value.extensions ~= nil and type(value.extensions) ~= "table" then
        invalid(path, "extensions must be an object")
    end
    return {
        identity = identity, contractFile = path, provides = provides,
        requires = requires, events = events, credentials = credentials,
        inputs = inputs, outputs = outputs, boundary = boundary,
        command = command, enabled = enabled ~= false, phase = value.phase,
        extensions = value.extensions,
    }
end

return Component
