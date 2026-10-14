// Readalong — Copyright © 2026 Tomas Gonzalez.
// Optional audible integration checks on a Mac with Apple's developer tools.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
if (process.platform !== "darwin") {
  console.log("SKIP: native integration requires macOS.");
  process.exit(0);
}
const filename = path.resolve(__dirname, "../main.js");
const moduleUnderTest = new Module(filename, module);
moduleUnderTest.filename = filename;
moduleUnderTest.paths = module.paths;
moduleUnderTest.require = (name) =>
  name === "obsidian"
    ? { Plugin: class {}, PluginSettingTab: class {} }
    : name === "electron"
      ? {}
      : require(name);
moduleUnderTest._compile(
  fs.readFileSync(filename, "utf8") +
    "\nmodule.exports.nativeTest={spawnNative,nativeVoices};",
  filename,
);
const { spawnNative, nativeVoices } = moduleUnderTest.exports.nativeTest;
const results = [];
function session() {
  const child = spawnNative(["--session", "/tmp/readalong-native-integration"]);
  let pending = "",
    stderr = "";
  const events = [],
    waiters = [];
  child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
  child.stdin.on("error", () => {});
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    let at;
    while ((at = pending.indexOf("\n")) >= 0) {
      const event = JSON.parse(pending.slice(0, at));
      pending = pending.slice(at + 1);
      events.push(event);
      for (const waiter of [...waiters])
        if (waiter.name === event.event) {
          clearTimeout(waiter.timer);
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
    }
  });
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
  return {
    child,
    events,
    closed,
    send: (command) => child.stdin.write(JSON.stringify(command) + "\n"),
    wait(name) {
      const existing = events.find((event) => event.event === name);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          name,
          resolve,
          timer: setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error("Timed out waiting for " + name + ": " + stderr));
          }, 12000),
        };
        waiters.push(waiter);
      });
    },
  };
}
(async () => {
  const voices = await nativeVoices();
  const voice =
    voices.find((v) => v.siri && v.language === "en-US") ||
    voices.find((v) => v.language.startsWith("en"));
  assert(voice, "Install an English voice before running this audible test.");
  const speak = (text) => ({
    action: "speak",
    text,
    voice: voice.id,
    rate: 0.47,
  });
  let s = session();
  s.send(
    speak(
      "Readalong reads your notes aloud. You can pause, resume, or stop a reading whenever you choose.",
    ),
  );
  await s.wait("started");
  s.send({ action: "pause" });
  await s.wait("paused");
  s.send({ action: "resume" });
  await s.wait("resumed");
  s.send({ action: "stop" });
  await s.wait("stopped");
  assert.equal((await s.closed).code, 0);
  results.push("pause / resume / stop");
  s = session();
  s.send(speak("Readalong is ready."));
  await s.wait("finished");
  assert.equal((await s.closed).code, 0);
  results.push("natural completion");
  s = session();
  s.send(speak("Closing the reader cancels this narration."));
  await s.wait("started");
  s.child.stdin.end();
  await s.wait("stopped");
  assert.equal((await s.closed).code, 0);
  results.push("parent pipe closure");
  s = session();
  s.send({ ...speak("Unavailable voice"), voice: "readalong.invalid.voice" });
  await s.wait("error");
  assert.equal((await s.closed).code, 1);
  results.push("unavailable voice");
  console.log(
    "PASS: bundled Swift pipe, voice discovery (" +
      voice.name +
      "), " +
      results.join(", ") +
      ".",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
