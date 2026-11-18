--!strict
-- Compile an actual declared generated operation without invoking its adapter.
local Fs = require("@std/fs")
local Process = require("@lute/process")
local Bootstrap = require("@ci/bootstrap")
local Workflow = require("@ci/github/workflows/workflow")
local Json = require("@formats/json")
local Operation = require("../../configuration/operation")

local path, requested = Process.args[2], Process.args[3]
if not path or path == "" or not requested or requested == "" then
    error("Expected an output directory and a declared generated operation", 0)
end
local config = Json.decode(Fs.readFileToString("config/ci/operations.json"))
local route = Operation.Resolve(config, {
    event = "workflow_dispatch", ref = "refs/heads/rehearsal", defaultBranch = "rehearsal",
    requested = requested, confirmPublish = true,
})
if route.mode ~= "generated" then error("Expected a generated operation", 0) end
-- The hosted native adapter uses the push plan for trusted manual operations.
-- No credentials or actual GitHub environment are needed for compilation.
Process.env.ACT = nil
Process.env.CI_OPERATION = route.plan
Process.env.CI_PUBLICATION_ENABLED = if route.publication then "true" else "false"
Process.env.CI_EXECUTION_PREFIX = route.branchPrefix
local tasks = Bootstrap.Plan("push")
local files = Workflow.Bundle(tasks, string.rep("a", 40), route.branchPrefix .. "1-1", "push")
if route.publication and not files["publish.yml"] then error("Publication graph was not generated", 0) end
if not route.publication and files["publish.yml"] then error("Unexpected publication graph", 0) end
Fs.createDirectory(path, { makeParents = true })
for name, source in files do
    Fs.writeStringToFile(path .. "/" .. name, source)
end
print("Compiled declared " .. requested .. " operation: " .. tostring(#tasks) .. " planned components; no publication executed")
