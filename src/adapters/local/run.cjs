"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const artifacts = require("./artifacts.cjs");
const root = process.cwd();
const packageRoot = path.resolve(__dirname, "../../..");
const { prepareStagedWorkflow } = require("./stage.cjs");

function operationFile(file) {
	const text = fs.readFileSync(path.resolve(root, file), "utf8");
	const match = text.match(/^\s*(?:export\s+)?operation\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^#\s]*))/m);
	return match ? match[1] ?? match[2] ?? match[3] : undefined;
}
function options(args) {
	const informational = args.some(arg => ["--help", "-h", "--version", "--list", "-l"].includes(arg));
	if (informational) return { informational: true, operation: "validation", event: "workflow_dispatch", args };
	const values = new Set(["-W", "--workflows", "-e", "--eventpath", "--input-file", "--secret-file", "--var-file", "--env-file", "--input", "--env", "--secret", "--var", "-P", "--platform", "-j", "--job", "--container-architecture", "--artifact-server-port", "--artifact-server-path", "--actor", "--remote-name", "--network", "--container-options", "--container-daemon-socket", "--action-cache-path", "--concurrent-jobs", "--github-instance", "--matrix", "-s"]);
	const events = new Set(["push", "pull_request", "workflow_dispatch", "repository_dispatch"]);
	let event, operation, payloadOperation, fileOperation = fs.existsSync(path.join(root, ".input")) ? operationFile(".input") : undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (events.has(arg)) event = arg;
		if (arg === "--input-file") fileOperation = args[index + 1] ? operationFile(args[index + 1]) : undefined;
		if ((arg === "-e" || arg === "--eventpath") && args[index + 1]) payloadOperation = JSON.parse(fs.readFileSync(path.resolve(root, args[index + 1]), "utf8")).inputs?.operation;
		if (arg.startsWith("--input-file=")) fileOperation = arg.slice(13) ? operationFile(arg.slice(13)) : undefined;
		if (arg.startsWith("--eventpath=") && arg.slice(12)) payloadOperation = JSON.parse(fs.readFileSync(path.resolve(root, arg.slice(12)), "utf8")).inputs?.operation;
		const input = arg.startsWith("--input=") ? arg.slice(8) : arg === "--input" ? args[index + 1] : undefined;
		if (input?.startsWith("operation=")) operation = input.slice(10);
		if (values.has(arg)) index++;
	}
	const config = JSON.parse(fs.readFileSync(path.join(root, "config/ci/operations.json"), "utf8"));
	const selectedEvent = event || "workflow_dispatch";
	const entry = { push: "push", pull_request: "pull", workflow_dispatch: "manual", repository_dispatch: "remote" }[selectedEvent];
	const caller = fs.readFileSync(path.join(root, ".github/workflows", entry + ".yml"), "utf8");
	const defaults = selectedEvent === "workflow_dispatch"
		? [...caller.matchAll(/^      operation:\s*\n(?:        [^\n]*\n)*?        default:\s*([a-z][a-z0-9-]*)\s*$/gm)].map(x => x[1])
		: [...new Set([...caller.matchAll(/^          CI_OPERATION:\s*([a-z][a-z0-9-]*)\s*$/gm)].map(x => x[1]).filter(x => config.operations?.[x]?.events?.includes(selectedEvent)))];
	if (defaults.length !== 1) throw new Error("Cannot resolve the caller's default operation");
	operation ??= fileOperation ?? payloadOperation ?? defaults[0];
	if (selectedEvent !== "workflow_dispatch" && operation !== defaults[0]) throw new Error("Operation is fixed by the event entry point");
	const route = config.operations?.[operation];
	if (!route) throw new Error("Unknown CI operation: " + operation);
	if (!route.events.includes(event || "workflow_dispatch")) throw new Error("Operation unavailable for this event: " + operation);
	if (route.publication || route.mode !== "readonly") throw new Error("Protected or publishing operations cannot run locally");
	return { informational, operation, event: event || "workflow_dispatch", args: event ? args : ["workflow_dispatch", ...args] };
}
// Translate external file arguments before running act in the isolated checkout.
const FILE_ARGUMENTS = new Set(["--input-file", "--secret-file", "--var-file", "--env-file", "--eventpath", "-e"]);
function resolveFileArguments(args, directory = root) {
	const output = [...args];
	for (let index = 0; index < output.length; index++) {
		const argument = output[index], separator = argument.indexOf("=");
		const flag = separator < 0 ? argument : argument.slice(0, separator);
		if (!FILE_ARGUMENTS.has(flag)) continue;
		if (separator >= 0) {
			const value = argument.slice(separator + 1);
			if (value) output[index] = flag + "=" + path.resolve(directory, value);
		} else {
			if (output[index + 1]) output[index + 1] = path.resolve(directory, output[index + 1]);
			index++;
		}
	}
	return output;
}
function timeoutMilliseconds(environment = process.env) {
	const minutes = environment.CI_LOCAL_TIMEOUT_MINUTES ?? "30";
	if (!/^[1-9][0-9]*$/.test(minutes) || Number(minutes) > 240) throw new Error("CI_LOCAL_TIMEOUT_MINUTES must be an integer from 1 to 240");
	return Number(minutes) * 60_000;
}

function stagedEventArguments(args, selected) {
	return [...selected.args];
}
async function main(args = process.argv.slice(2)) {
	const selected = options(args);
	const check = spawnSync("act", ["--version"], { cwd: root, encoding: "utf8", windowsHide: true });
	if (check.error) throw new Error("act is unavailable on PATH. Install act and restart the terminal/editor environment.");
	if (selected.informational) return spawnSync("act", selected.args, { cwd: root, stdio: "inherit", windowsHide: true }).status ?? 1;
	const stageTimeout = timeoutMilliseconds();
	if (!fs.existsSync(path.join(root, ".actrc"))) throw new Error("Run workspace dependency setup to generate .actrc");
	const runId = crypto.randomUUID(), runRoot = artifacts.target(root, "build/run/" + runId);
	const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
	const { tracked, files: snapshot, digest: workspaceDigest } = artifacts.snapshot(root);
	const directory = path.join(root, ".workspace/ci/runs"); fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(runRoot, { recursive: true });
	const file = path.join(directory, runId + ".json");
	const record = { version: 2, id: runId, runner: "act", scope: "pipeline", operation: selected.operation, source, workspaceDigest, state: "running", pid: process.pid, startedAt: new Date().toISOString(), stages: { start: "running", [selected.operation]: "pending", publish: "disabled" }, runDirectory: path.relative(root, runRoot).replaceAll("\\", "/") };
	function publish() { fs.writeFileSync(file + ".tmp", JSON.stringify(record)); fs.renameSync(file + ".tmp", file); }
	function execute(argv, cwd, log) {
		return new Promise((resolve, reject) => {
			const descriptor = fs.openSync(path.join(runRoot, log), "w");
			const child = spawn("act", argv, {
				cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, CI_LOCAL_RUN_ID: runId },
				timeout: stageTimeout,
			});
			let failure;
			for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
				stream.on("data", chunk => {
					fs.writeSync(descriptor, chunk);
					output.write(chunk);
				});
			}
			child.once("error", error => { failure = error; });
			child.once("close", (code, signal) => {
				fs.closeSync(descriptor);
				if (failure || code !== 0) {
					reject(new Error(failure?.message || `act exited with status ${code}${signal ? ` (signal ${signal})` : ""}; see ${record.runDirectory}/${log}`));
				} else resolve();
			});
		});
	}
	const transport = path.join(runRoot, "transport");
	const port = execFileSync(process.execPath, ["-e", "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"], { encoding: "utf8", windowsHide: true }).trim();
	const readToken = false && args.some((arg, index) => arg.startsWith("--secret=GITHUB_TOKEN=") || ((arg === "--secret" || arg === "-s") && (args[index + 1] === "GITHUB_TOKEN" || args[index + 1]?.startsWith("GITHUB_TOKEN="))));
	const runtimeArgs = [...(readToken ? ["--secret-file", ""] : ["--secret-file", "", "--secret", "GITHUB_TOKEN="]),"--env", "ACT=true", "--env", "CI_WORKSPACE_DIGEST=" + workspaceDigest,"--artifact-server-path", transport, "--artifact-server-port", port, "--env", "CI_LOCAL_RUN_ID=" + runId];
	let worktree, failureStage = "start";
	publish();
	try {
		console.log(`Start ${selected.operation}: ${record.runDirectory}`);
		worktree = path.join(runRoot, "worktree");
		execFileSync("git", ["clone", "--no-hardlinks", "--no-checkout", root, worktree], { windowsHide: true, stdio: "pipe" });
		execFileSync("git", ["checkout", "--detach", source], { cwd: worktree, windowsHide: true, stdio: "pipe" });
		const origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
		execFileSync("git", ["remote", "set-url", "origin", origin], { cwd: worktree, windowsHide: true });
		const priorFiles = execFileSync("git", ["ls-files", "-z"], { cwd: worktree }).toString().split("\0").filter(Boolean);
		for (const name of priorFiles) if (!tracked.includes(name)) fs.rmSync(artifacts.target(worktree, name), { force: true });
		for (const [name, bytes] of snapshot) { const file = artifacts.target(worktree, name); if (bytes === null) fs.rmSync(file, { force: true }); else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); } }
		fs.copyFileSync(path.join(worktree, ".vscode/config/act/actrc"), path.join(worktree, ".actrc"));
		execFileSync("git", ["add", "-A"], { cwd: worktree, windowsHide: true, stdio: "pipe" });
		const event = stagedEventArguments(args, selected)[0];
		prepareStagedWorkflow(path.join(worktree, ".github/workflows/bootstrap.yml"), packageRoot);
		const ref = spawnSync("git", ["symbolic-ref", "-q", "HEAD"], {cwd:root,encoding:"utf8"}).stdout?.trim() || "refs/heads/local";
		const request = { event, ref, sha:source, operation:selected.operation, publish:false, ...(event === "pull_request" ? {pr:1} : {}) };
		const dispatchFile=path.join(runRoot,"dispatch.json");
		fs.writeFileSync(dispatchFile,JSON.stringify({action:"ci-request",repository:{default_branch:"source"},sender:{login:"github-actions[bot]"},client_payload:request}));
		function hostedArgs() {
			const next=[];
			const excluded=new Set(["-W","--workflows","--input","--input-file","-e","--eventpath"]);
			const supplied=resolveFileArguments(selected.args);
			for(let i=0;i<supplied.length;i++){
				const arg=supplied[i];
				if(excluded.has(arg)){i++;continue;}
				if(/^(push|pull_request|workflow_dispatch|repository_dispatch)$/.test(arg)||/^--(input(?:-file)?|workflows|eventpath)=/.test(arg))continue;
				next.push(arg);
			}
			return ["repository_dispatch","--eventpath",dispatchFile,...next];
		}
		const config = JSON.parse(fs.readFileSync(path.join(root, "config/ci/operations.json"), "utf8"));
		const route = config.operations[selected.operation];
		const authored = ["--workflows", ".github/workflows/_act-entry.yml"];
		failureStage = selected.operation;
		record.stages.start = "not required";
		record.stages[selected.operation] = "running";
		publish();
		await execute([...hostedArgs(), ...authored, ...runtimeArgs], worktree, "execution.log");
		record.stages[selected.operation] = "passed";
		if (route.hostTests) {
			failureStage = "export";
			record.stages.export = "running";
			publish();
			const tasks = artifacts.readBuildPlan(runRoot);
			const manifest = artifacts.exportOutputs(runRoot, {runId,source,workspaceDigest,operation:selected.operation,components:tasks.map(task=>task.identity),tasks});
			artifacts.promote(root,runRoot,manifest);
			record.stages.export="passed";
			record.artifacts=record.runDirectory+"/outputs";
			record.manifest=record.artifacts+"/manifest.json";
		}
		record.state = "passed";
		record.exitCode = 0;
		record.reports = record.runDirectory + "/execution.log";
		console.log("Completed " + selected.operation + ": " + record.reports);
	} catch (error) {
		try { artifacts.receiveDiagnostics(runRoot); } catch (failure) { record.diagnosticsFailure = failure.message.slice(0, 500); }
		for (const stage of Object.keys(record.stages)) if (record.stages[stage] === "pending") record.stages[stage] = "blocked";
		record.state = "failed"; record.exitCode = 1; record.failureStage = failureStage; record.stages[failureStage] = "failed"; record.failure = error.message.slice(0, 1000); console.error(record.failure);
	} finally {
		if (worktree) {
			try {
				const checked = artifacts.target(root, record.runDirectory + "/worktree");
				if (checked !== path.resolve(worktree) || fs.lstatSync(checked, { throwIfNoEntry: false })?.isSymbolicLink()) record.cleanup = "Isolated checkout retained for inspection";
				else {
				// A failed run must not block the VS Code task on a large Windows worktree teardown.
				const removal = spawnSync(process.execPath, [
					"-e", "require('node:fs').rmSync(process.argv[1],{recursive:true,force:true,maxRetries:2,retryDelay:100})", checked,
				], { windowsHide: true, timeout: 30_000, encoding: "utf8" });
				if (removal.error || removal.status !== 0) {
					record.cleanup = "Worktree retained after bounded cleanup: " + checked;
					console.error(record.cleanup);
				}
				}
			} catch (error) {
				record.cleanup = "Isolated checkout cleanup failed: " + error.message.slice(0, 300);
				console.error(record.cleanup);
			}
		}
		record.finishedAt = new Date().toISOString(); publish();
	}
	return record.exitCode;
}
module.exports = { options, main, prepareStagedWorkflow, stagedEventArguments, resolveFileArguments, timeoutMilliseconds };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
