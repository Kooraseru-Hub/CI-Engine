--!strict
-- Adapted from Template PR #43: ci/bootstrap/planning/init.luau.
-- The planner does not own event routing, phases, credentials, or languages.

local Glob = require("./glob")

local Graph = {}

local function fail(message: string): never
    error("CI Engine plan: " .. message, 0)
end

local function keys<T>(source: { [string]: T }): { string }
    local result: { string } = {}
    for key in source do
        table.insert(result, key)
    end
    table.sort(result)
    return result
end

local function matches(identity: string, patterns: { string }): boolean
    for _, pattern in patterns do
        if pattern == "*" or pattern == identity or Glob.Match(identity, pattern) then
            return true
        end
        -- Preserve the current consumer meaning of "quality/*": the subtree,
        -- including nested components, rather than exactly one segment.
        if pattern:sub(-2) == "/*"
            and identity:sub(1, #pattern - 1) == pattern:sub(1, -2) then
            return true
        end
    end
    return false
end

local function verifyOutputs(active: { [string]: any }): ()
    local claimed: { { name: string, pattern: string } } = {}
    for _, name in keys(active) do
        for _, pattern in active[name].outputs do
            for _, earlier in claimed do
                if Glob.Overlaps(pattern, earlier.pattern) then
                    fail("output collision: " .. earlier.name .. " (" .. earlier.pattern
                        .. ") and " .. name .. " (" .. pattern .. ")")
                end
            end
            table.insert(claimed, { name = name, pattern = pattern })
        end
    end
end

-- Return a stable topological order AND the graph edges. The executor is free
-- to use sequential, matrix, or native GitHub workflow backends later.
function Graph.Plan(components: { [string]: any }, patterns: { string }, event: string, mode: string): {
    ordered: { string },
    needs: { [string]: { string } },
}
    local available: { [string]: any } = {}
    for identity, component in components do
        if component.enabled and (#component.events == 0 or table.find(component.events, event)) then
            available[identity] = component
        end
    end
    local chosen: { [string]: any } = {}
    for _, identity in keys(available) do
        if matches(identity, patterns) then
            chosen[identity] = available[identity]
        end
    end

    local needs: { [string]: { string } } = {}
    local visiting: { [string]: boolean } = {}
    local resolved: { [string]: boolean } = {}
    local function resolve(identity: string): ()
        if visiting[identity] then fail("dependency cycle at " .. identity) end
        if resolved[identity] then return end
        local component = chosen[identity]
        if not component then fail("unavailable component: " .. identity) end
        if mode == "readonly" and (component.boundary ~= "read" or #component.credentials > 0) then
            fail("privileged component selected by read-only operation: " .. identity)
        end
        visiting[identity] = true
        local dependencies: { [string]: boolean } = {}
        for _, capability in component.requires do
            local found: string? = nil
            for _, provider in keys(available) do
                if table.find(available[provider].provides, capability) then
                    if found then
                        fail("ambiguous provider for " .. capability .. ": " .. found .. " and " .. provider)
                    end
                    found = provider
                end
            end
            if not found then
                fail(identity .. " requires unavailable capability " .. capability)
            end
            chosen[found] = available[found]
            resolve(found)
            dependencies[found] = true
        end
        needs[identity] = keys(dependencies)
        visiting[identity] = nil
        resolved[identity] = true
    end
    for _, identity in keys(chosen) do resolve(identity) end

    -- Duplicate providers among selected components are ambiguous even if no
    -- selected component currently consumes their capability.
    local providers: { [string]: string } = {}
    for _, identity in keys(chosen) do
        for _, capability in chosen[identity].provides do
            local original = providers[capability]
            if original then
                fail("duplicate provider for " .. capability .. ": " .. original .. " and " .. identity)
            end
            providers[capability] = identity
        end
    end
    verifyOutputs(chosen)

    local degree: { [string]: number } = {}
    local successors: { [string]: { string } } = {}
    for identity in chosen do
        degree[identity] = 0
        successors[identity] = {}
    end
    for identity, dependencies in needs do
        for _, dependency in dependencies do
            degree[identity] += 1
            table.insert(successors[dependency], identity)
        end
    end
    local ready: { string } = {}
    for identity, count in degree do
        if count == 0 then table.insert(ready, identity) end
    end
    table.sort(ready)
    local ordered: { string } = {}
    while #ready > 0 do
        local identity = table.remove(ready, 1)
        if not identity then break end
        table.insert(ordered, identity)
        for _, successor in successors[identity] do
            degree[successor] -= 1
            if degree[successor] == 0 then table.insert(ready, successor) end
        end
        table.sort(ready)
    end
    if #ordered ~= #keys(chosen) then fail("dependency cycle detected") end
    return { ordered = ordered, needs = needs }
end

return Graph
