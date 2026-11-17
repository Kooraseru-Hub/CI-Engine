"use strict";
const args = process.argv.slice(2);
if (args[0] === "sync-inputs") {
  try { require("./src/adapters/local/inputs.cjs").syncInputs(process.cwd(), args.includes("--check")); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
  if (args[0] === "run") {
    args.shift();
    if (args[0] && !args[0].startsWith("-")) args.splice(0, 1, "--input", "operation=" + args[0]);
  }
  require("./src/adapters/local/run.cjs").main(args).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
