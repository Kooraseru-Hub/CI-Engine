"use strict";
const { main } = require("./src/adapters/local/run.cjs");
const args = process.argv.slice(2);
if (args[0] === "run") {
  args.shift();
  if (args[0] && !args[0].startsWith("-")) args.splice(0, 1, "--input", "operation=" + args[0]);
}
main(args).then(code => { process.exitCode = code; }).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
