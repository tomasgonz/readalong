// Readalong — Copyright © 2026 Tomas Gonzalez.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = path.resolve(__dirname, "../main.js");

async function load(platform, saved = {}) {
  const commands = [],
    settings = [],
    messages = [],
    executions = [],
    saves = [];
  class Plugin {
    async loadData() {
      return saved;
    }
    async saveData(data) {
      saves.push({ ...data });
    }
    addCommand(command) {
      commands.push(command);
    }
    addRibbonIcon() {}
    addStatusBarItem() {
      return { empty() {} };
    }
    registerEvent() {}
    addSettingTab(tab) {
      this.tab = tab;
    }
  }
  class PluginSettingTab {
    constructor(app, plugin) {
      this.plugin = plugin;
      this.containerEl = {
        empty() {
          settings.length = 0;
        },
        createEl(tag, options) {
          messages.push(options.text);
        },
      };
    }
  }
  class Setting {
    constructor() {
      settings.push(this);
    }
    setName(value) {
      this.name = value;
      return this;
    }
    setDesc() {
      return this;
    }
    addDropdown(fn) {
      const dropdown = {
        options: {},
        addOption(id, label) {
          this.options[id] = label;
          return this;
        },
        setValue(value) {
          this.value = value;
          return this;
        },
        onChange(fn) {
          this.change = fn;
          return this;
        },
      };
      this.dropdown = dropdown;
      fn(dropdown);
      return this;
    }
    addText(fn) {
      fn({
        inputEl: {},
        setValue() {
          return this;
        },
        onChange() {
          return this;
        },
      });
      return this;
    }
    addSlider(fn) {
      fn({
        setLimits() {
          return this;
        },
        setValue() {
          return this;
        },
        setDynamicTooltip() {
          return this;
        },
        onChange() {
          return this;
        },
      });
      return this;
    }
    addButton(fn) {
      fn({
        setButtonText() {
          return this;
        },
        onClick() {
          return this;
        },
      });
      return this;
    }
  }
  const context = {
    module: { exports: {} },
    process: { platform },
    setTimeout,
    clearTimeout,
    require(name) {
      if (name === "obsidian")
        return {
          Plugin,
          PluginSettingTab,
          Setting,
          MarkdownView: class {},
          Notice: class {
            constructor(text) {
              messages.push(text);
            }
          },
        };
      if (name === "electron") return {};
      if (name === "child_process")
        return {
          spawn() {
            throw new Error("Unexpected native speech process");
          },
          execFile(exe, args, options, callback) {
            executions.push(exe);
            callback(null, exe === "/bin/ps" ? "" : "Daniel en_GB # Hello\n");
          },
        };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(source, "utf8"), context, {
    filename: source,
  });
  const plugin = new context.module.exports();
  plugin.app = {
    vault: {
      adapter: { getBasePath: () => "/mock-vault" },
      configDir: ".obsidian",
    },
    workspace: { on() {} },
  };
  plugin.manifest = { id: "readalong" };
  await plugin.onload();
  return { plugin, commands, settings, messages, executions, saves };
}

(async () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const t = await load(platform);
    assert.equal(
      t.plugin.settings.provider,
      platform === "darwin" ? "mac" : "eleven",
    );
    assert.equal(
      t.commands.some((c) => c.id === "read-with-native-voice"),
      platform === "darwin",
    );
    await t.plugin.tab.display();
    const dropdown = t.settings.find(
      (s) => s.name === "Narration service",
    ).dropdown;
    assert.deepEqual(
      Object.keys(dropdown.options).sort(),
      platform === "darwin" ? ["eleven", "mac", "native"] : ["eleven"],
    );
    let cloudText;
    t.plugin.speakCloud = (text) => {
      cloudText = text;
    };
    t.plugin.speak("Explicit cloud reading", "eleven");
    assert.equal(cloudText, "Explicit cloud reading");
    t.plugin.stop();
    if (platform !== "darwin")
      assert.equal(
        t.executions.length,
        0,
        "No macOS process enumeration or voice lookup on other systems",
      );
  }
  for (const platform of ["win32", "linux"]) {
    for (const provider of ["native", "mac"]) {
      const t = await load(platform, {
        provider,
        nativeVoice: "saved-siri",
        voice: "saved-classic",
        elevenVoice: "saved-cloud",
      });
      await t.plugin.tab.display();
      assert.equal(
        t.plugin.settings.provider,
        provider,
        "Retain synced choice until user explicitly changes it",
      );
      assert.equal(t.saves.length, 0);
      assert(t.messages.some((text) => text.includes("requires macOS")));
      assert(!t.settings.some((s) => s.name === "ElevenLabs API key"));
      let cloudCalls = 0;
      t.plugin.speakCloud = () => {
        cloudCalls++;
      };
      t.plugin.speak("A private local passage");
      assert.equal(
        cloudCalls,
        0,
        "Never switch local reading to cloud implicitly",
      );
      assert.equal(t.executions.length, 0);
      const dropdown = t.settings.find(
        (s) => s.name === "Narration service",
      ).dropdown;
      assert.deepEqual(Object.keys(dropdown.options), ["", "eleven"]);
      await dropdown.change("");
      assert.equal(t.saves.length, 0);
      await dropdown.change("eleven");
      assert.equal(t.plugin.settings.provider, "eleven");
      assert.equal(t.plugin.settings.nativeVoice, "saved-siri");
      assert.equal(t.plugin.settings.voice, "saved-classic");
      assert.equal(t.plugin.settings.elevenVoice, "saved-cloud");
      assert(t.settings.some((s) => s.name === "ElevenLabs API key"));
      assert.equal(
        cloudCalls,
        0,
        "Selecting a service does not start narration",
      );
      t.plugin.speak("Explicit reading after service selection");
      assert.equal(cloudCalls, 1);
    }
  }
  const mac = await load("darwin", {
    provider: "native",
    nativeVoice: "saved-siri",
  });
  assert.equal(mac.plugin.settings.provider, "native");
  assert.equal(mac.plugin.settings.nativeVoice, "saved-siri");
  assert.equal(mac.saves.length, 0);
  console.log(
    "PASS: macOS/Windows/Linux defaults, available services, command registration, process guards, synced settings, explicit cloud opt-in and preserved voice choices.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
