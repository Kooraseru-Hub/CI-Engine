--!strict
local Process = require("@lute/process")
local Json = require("@engine/configuration/json")
local Component = require("@engine/contracts/component")
local HostTests = {}
local runners = {
    ["windows-latest"] = true, ["windows-2025"] = true,
    ["windows-11-arm"] = true, ["windows-11-vs2026-arm"] = true,
}
function HostTests.Plan(spec: any, localExecution: boolean?): (string, string, string)
    if spec == nil or localExecution then return "false", '{"include":[]}', "" end
    if type(spec) ~= "table" or type(spec.command) ~= "table"
        or type(spec.artifactPath) ~= "string" or not Component.ValidRoot(spec.artifactPath)
        or spec.artifactPath:sub(1, 6) ~= "build/" then
        error("Invalid native host-test declaration", 0)
    end
    local env = table.clone(Process.env)
    env.GH_TOKEN = ""
    env.GITHUB_TOKEN = ""
    local result = Process.run(spec.command, { cwd = Process.cwd(), env = env })
    if not result.ok then error("Native host-test plan failed", 0) end
    local entries: any = Json.decode(result.stdout)
    if type(entries) ~= "table" or #entries < 1 or #entries > 64 then error("Expected 1-64 native host tests", 0) end
    local seen = {}
    local matrix = {}
    for key, entry in entries do
        if type(key) ~= "number" or key < 1 or key % 1 ~= 0 or key > #entries
            or type(entry) ~= "table" or type(entry.id) ~= "string"
            or not entry.id:match("^[a-z][a-z0-9-]*$") or seen[entry.id]
            or not runners[entry.runner]
            or type(entry.file) ~= "string" or not entry.file:match("^[a-zA-Z0-9_-]+%.exe$")
            or type(entry.expected) ~= "table" or #entry.expected == 0 then
            error("Invalid native host-test matrix entry", 0)
        end
        for _, line in entry.expected do
            if type(line) ~= "string" or line == "" or line:find("[%c]") then error("Invalid expected output", 0) end
        end
        seen[entry.id] = true
        table.insert(matrix, { id = entry.id, runner = entry.runner, file = entry.file, expected = Json.encode(entry.expected) })
    end
    return "true", Json.encode({ include = matrix }), spec.artifactPath
end
return HostTests
