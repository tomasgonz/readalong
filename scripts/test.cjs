// Readalong — Copyright © 2026 Tomas Gonzalez.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function run(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}
run(["scripts/build.cjs", "--check"]);
run(["--check", "main.js"]);
run(["tests/platforms.cjs"]);
run(["tests/cloud.cjs"]);
run(["tests/credentials.cjs"]);
if (process.platform === "darwin") run(["tests/reader.cjs"]);
else console.log("SKIP: macOS reader lifecycle mock uses the macOS backend.");
