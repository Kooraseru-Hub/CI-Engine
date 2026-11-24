--!strict
-- The accepted transport plan owns native bundle identity, even when a
-- downstream job runs in a later GitHub Actions attempt.
local RunIdentity = {}

function RunIdentity.Resolve(environment: { [string]: string }, pid: number): string
    local id = environment.CI_LOCAL_RUN_ID or environment.CI_RUN_ID
        or `{environment.GITHUB_RUN_ID or "cli"}-{environment.GITHUB_RUN_ATTEMPT or tostring(pid)}`
    if environment.GITHUB_ACTIONS == "true" and environment.ACT ~= "true" then
        local bundle = environment.CI_DELIVERY_BUNDLE_PATH or ""
        local planned = bundle:match("^build/run/([^/]+)/transport/bundles/?$")
        if planned then
            local run, attempt = planned:match("^(%d+)%-(%d+)$")
            local current = tonumber(environment.GITHUB_RUN_ATTEMPT)
            local producing = tonumber(attempt)
            if not run or run ~= environment.GITHUB_RUN_ID or not producing or producing < 1
                or not current or producing > current then
                error("Native bundle does not belong to the admitted workflow run", 0)
            end
            id = planned
        end
    end
    if not id:match("^[%w_-]+$") then error("Unsafe execution run identity", 0) end
    return id
end

return RunIdentity
