--!strict
-- Adapted from Template PR #43's tracked-entry discovery and validation.
-- All source-code execution happens after metadata has been validated.

local Fs = require("@std/fs")
local Process = require("@lute/process")
local Json = require("@std/json")
local Component = require("@engine/contracts/component")

local Discovery = {}

function Discovery.Load(root: string): { [string]: any }
    if not Component.ValidRoot(root) then
        error("CI Engine: unsafe component root: " .. root, 0)
    end
    local result = Process.run({ "git", "ls-files", "--stage", "--", root }, { cwd = Process.cwd() })
    if not result.ok then error("CI Engine: unable to inspect tracked components", 0) end
    local found: { [string]: any } = {}
    local folded: { [string]: string } = {}
    for line in result.stdout:gmatch("[^\r\n]+") do
        local mode, path = line:match("^(%d+)%s+[%da-fA-F]+%s+%d+\t(.+)$")
        if not mode or not path then
            error("CI Engine: invalid git index entry", 0)
        end
        if mode == "120000" or mode == "160000" then
            error("CI Engine: linked component entry: " .. path, 0)
        end
        if path:sub(-15) == "/component.json" then
            local identity = path:sub(#root + 2, -16)
            if not Component.ValidIdentity(identity) then
                error("CI Engine: unsafe component identity: " .. identity, 0)
            end
            local lower = identity:lower()
            if folded[lower] then
                error("CI Engine: ambiguous identities: " .. folded[lower] .. " and " .. identity, 0)
            end
            folded[lower] = identity
            if not Fs.exists(path) then
                error("CI Engine: missing tracked component: " .. path, 0)
            end
            local ok, value = pcall(function()
                return Json.deserialize(Fs.readFileToString(path))
            end)
            if not ok then
                error("CI Engine: invalid JSON in " .. path .. ": " .. tostring(value), 0)
            end
            found[identity] = Component.Validate(identity, path, value)
        end
    end
    return found
end

return Discovery
