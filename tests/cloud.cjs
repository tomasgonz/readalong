// Readalong — Copyright © 2026 Tomas Gonzalez.
const fs = require("fs"),
  vm = require("vm"),
  assert = require("assert"),
  path = require("path"),
  os = require("os");
let stopped = 0;
class FakeAudio {
  play() {
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
  pause() {
    stopped++;
  }
  removeAttribute() {}
  load() {}
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), "readalong-cloud-test-"));
const box = {
  module: { exports: {} },
  require: (n) =>
    n === "obsidian"
      ? { Plugin: class {}, PluginSettingTab: class {}, Notice: class {} }
      : n === "electron"
        ? {}
        : require(n),
  process,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  Blob: class {},
  Audio: FakeAudio,
};
vm.runInNewContext(
  fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8"),
  box,
);
const Reader = box.module.exports,
  { splitSpeech } = Reader;
assert(splitSpeech("word ".repeat(1500)).every((x) => x.length <= 2200));
assert(splitSpeech("x".repeat(6000)).every((x) => x.length <= 2200));
function plugin() {
  const p = new Reader();
  p.settings = { provider: "eleven", elevenVoice: "voice-test", audioSpeed: 1 };
  p.session = 0;
  p.apiKey = "FAKE-TEST-KEY";
  p.cacheDir = path.join(root, "cache");
  p.updateStatus = () => {};
  p.cleanupOrphans = () => {};
  return p;
}
(async () => {
  const p = plugin();
  let calls = 0;
  p.apiRequest = async () => {
    calls++;
    return Buffer.from("audio-test");
  };
  await p.speakCloud("A short test.");
  assert.equal(calls, 1);
  assert.equal(p.active, false);
  await p.speakCloud("A short test.");
  assert.equal(calls, 1, "Replay must use cache");
  let resolveRequest;
  p.apiRequest = () => new Promise((r) => (resolveRequest = r));
  const pending = p.speakCloud("Different text.");
  p.stop();
  resolveRequest(Buffer.from("audio"));
  await pending;
  assert.equal(p.active, false);
  assert.equal(p.audio, null);
  assert.equal(
    fs.readdirSync(p.cacheDir).length,
    1,
    "Stopped generation must not be cached or played",
  );
  p.clearCache();
  assert.equal(fs.readdirSync(p.cacheDir).length, 0);
  console.log(
    "Passed chunk limits, cloud completion, cached replay, Stop during generation and cache removal. No network requests made.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(root, { recursive: true, force: true }));
