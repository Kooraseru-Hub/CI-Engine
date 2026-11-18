-- src/native/github/workflows/workflow.luau
--!strict

local Configuration = require("@ci/github/configuration")
local Contract = require("@ci/bootstrap/contracts/contract")

local Workflow = {}

function Workflow.JobId(identity: string): string
	return "component_" .. Contract.Key(identity)
end

function Workflow.ComponentEnvironment(configuration: Configuration.Configuration, profile: Configuration.Profile, task: Contract.Task): string
	local match: string? = nil
	for name, bindings in configuration.environments do
		if name == profile.bootstrapEnvironment or name == profile.reportingEnvironment then
			continue
		end
		local count = 0
		for _ in bindings do
			count += 1
		end
		if count ~= #task.credentials then
			continue
		end
		local covers = true
		for _, role in task.credentials do
			covers = covers and bindings[role] ~= nil
		end
		if covers then
			if match then
				error(`{task.identity}: ambiguous credential environments for {table.concat(task.credentials, ", ")}`, 0)
			end
			match = name
		end
	end
	return match or error(`{task.identity}: no credential environment for {table.concat(task.credentials, ", ")}`, 0)
end

return Workflow
