// Readalong — Copyright © 2026 Tomas Gonzalez.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
for (const [name, available, backend, expected] of [
  ["unavailable", false, undefined, false],
  ["Linux plaintext fallback", true, "basic_text", false],
  ["Linux secret store", true, "gnome_libsecret", true],
  ["Mac secure store", true, undefined, true],
]) {
  const writes = [];
  let encryptions = 0;
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: () => {
      encryptions++;
      return Buffer.from("encrypted-test-placeholder");
    },
    ...(backend ? { getSelectedStorageBackend: () => backend } : {}),
  };
  const context = {
    module: { exports: {} },
    process,
    require(name) {
      if (name === "obsidian")
        return { Plugin: class {}, PluginSettingTab: class {} };
      if (name === "electron") return { safeStorage };
      if (name === "fs")
        return {
          writeFileSync: (...args) => writes.push(args),
          existsSync: () => false,
        };
      return require(name);
    },
  };
  vm.runInNewContext(source, context);
  const reader = new context.module.exports();
  reader.keyPath = "/mock/readalong/eleven-key.enc";
  assert.equal(reader.saveKey(" example-test-key "), expected, name);
  assert.equal(reader.apiKey, "example-test-key");
  assert.equal(writes.length, expected ? 1 : 0, name);
  assert.equal(encryptions, expected ? 1 : 0, name);
}
console.log(
  "PASS: keys remain in memory when secure storage is unavailable or uses the Linux plaintext fallback.",
);
