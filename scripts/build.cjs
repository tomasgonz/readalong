// Readalong — Copyright © 2026 Tomas Gonzalez.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const swift = fs.readFileSync(
  path.join(root, "src/native-reader.swift"),
  "utf8",
);
if (swift.includes("`") || swift.includes("${"))
  throw new Error(
    "Swift source cannot be represented safely as a raw template literal.",
  );
const source = fs.readFileSync(path.join(root, "src/main.cjs"), "utf8");
const output =
  "// Readalong — Copyright © 2026 Tomas Gonzalez.\n// Built by scripts/build.cjs from the readable sources in src/.\n" +
  "const NATIVE_READER_SOURCE = String.raw`" +
  swift +
  "`;\n\n" +
  source;
const target = path.join(root, "main.js");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== output)
    throw new Error("main.js is out of date. Run node scripts/build.cjs.");
} else fs.writeFileSync(target, output);
