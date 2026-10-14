// Readalong — Copyright © 2026 Tomas Gonzalez.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const root = path.resolve(__dirname, ".."),
  source = path.join(root, "main.js");
const notices = [],
  spawned = [],
  settings = [];
class Plugin {}
class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
class MarkdownView {}
class Setting {
  constructor(container) {
    this.container = container;
    settings.push(this);
  }
  setName(v) {
    this.name = v;
    return this;
  }
  setDesc(v) {
    this.desc = v;
    return this;
  }
  addDropdown(fn) {
    const d = {
      options: {},
      addOption(k, v) {
        this.options[k] = v;
        return this;
      },
      setValue(v) {
        this.value = v;
        return this;
      },
      onChange(fn) {
        this.change = fn;
        return this;
      },
    };
    this.dropdown = d;
    fn(d);
    return this;
  }
  addButton(fn) {
    const b = {
      setButtonText() {
        return this;
      },
      onClick(fn) {
        this.click = fn;
        return this;
      },
    };
    this.button = b;
    fn(b);
    return this;
  }
  addSlider(fn) {
    const s = {
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
    };
    fn(s);
    return this;
  }
  addText(fn) {
    const t = {
      inputEl: {},
      setValue() {
        return this;
      },
      onChange() {
        return this;
      },
    };
    fn(t);
    return this;
  }
}
function child() {
  const c = new EventEmitter();
  c.pid = 1000 + spawned.length;
  c.exitCode = null;
  c.stderr = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stdin = new EventEmitter();
  c.commands = [];
  c.signals = [];
  c.stdin.write = (s) => {
    c.commands.push(JSON.parse(s));
    return true;
  };
  c.stdin.end = (s) => {
    if (s) c.commands.push(JSON.parse(s));
    queueMicrotask(() => {
      c.exitCode = 0;
      c.emit("close", 0);
    });
  };
  c.kill = (s) => {
    c.signals.push(s);
    if (s === "SIGKILL" || s === "SIGTERM") {
      c.exitCode = 0;
      c.emit("close", 0);
    }
    return true;
  };
  return c;
}
let runtimeError = null;
let deferRuntime = false;
let pendingRuntime;
const cp = {
  spawn(exe, args, opts) {
    const c = child();
    Object.assign(c, { exe, args, opts });
    spawned.push(c);
    const sourcePipe = new EventEmitter();
    sourcePipe.end = (source) => {
      c.nativeSource = source;
      if (args.includes("--list"))
        queueMicrotask(() => {
          c.stdout.emit(
            "data",
            Buffer.from(
              JSON.stringify([
                {
                  id: "com.apple.siri.natural.Simone",
                  name: "Voice 2",
                  language: "en-US",
                  quality: 2,
                  siri: true,
                },
              ]),
            ),
          );
          c.exitCode = 0;
          c.emit("close", 0);
        });
    };
    c.stdio = [c.stdin, c.stdout, c.stderr, sourcePipe];
    return c;
  },
  execFile(exe, args, options, cb) {
    if (exe === "/usr/bin/xcode-select") {
      if (deferRuntime) pendingRuntime = cb;
      else cb(runtimeError, "/mock-tools");
      return;
    }
    if (args[0] === "--list")
      cb(
        null,
        JSON.stringify([
          {
            id: "com.apple.siri.natural.Simone",
            name: "Voice 2",
            language: "en-US",
            quality: 2,
            siri: true,
          },
        ]),
      );
    else if (exe === "/usr/bin/say")
      cb(null, "Daniel (English (UK)) en_GB # Hello\n");
    else cb(null, "");
  },
};
const m = new Module(source, module);
m.filename = source;
m.paths = module.paths;
const normal = m.require.bind(m);
m.require = (name) =>
  name === "obsidian"
    ? {
        Plugin,
        PluginSettingTab,
        Setting,
        MarkdownView,
        Notice: class {
          constructor(s) {
            notices.push(s);
          }
        },
      }
    : name === "child_process"
      ? cp
      : name === "electron"
        ? {}
        : normal(name);
m._compile(
  fs.readFileSync(source, "utf8") +
    "\nmodule.exports.ReaderSettings=ReaderSettings;",
  source,
);
const Reader = m.exports,
  p = new Reader(),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reader-plugin-test-"));
Object.assign(p, {
  settings: {
    provider: "native",
    nativeVoice: "com.apple.siri.natural.Simone",
    nativeRate: 0.47,
    voice: "Daniel",
    rate: 175,
  },
  readPath: path.join(tmp, "active-reading.txt"),
  proc: null,
  active: false,
  session: 0,
  saveData: async () => {},
});
const emit = (c, event) =>
  c.stdout.emit("data", Buffer.from(JSON.stringify({ event }) + "\n"));
(async () => {
  await p.speak("## Heading\nHello **world** and [[some/path|reader]].");
  let c = p.proc;
  assert.equal(c.readerBackend, "native");
  assert.equal(c.commands[0].text, "Heading\nHello world and reader.");
  assert.equal(c.commands[0].voice, "com.apple.siri.natural.Simone");
  assert.equal(c.commands[0].rate, 0.47);
  assert.equal(c.exe, "/usr/bin/swift");
  assert.equal(c.args[0], "/dev/fd/3");
  assert.equal(c.args[1], "--session");
  assert(c.nativeSource.includes("AVSpeechSynthesizer"));
  assert.equal(c.opts.stdio.length, 4);
  emit(c, "started");
  p.togglePause();
  assert.equal(c.commands.at(-1).action, "pause");
  emit(c, "paused");
  assert.equal(p.paused, true);
  p.togglePause();
  assert.equal(c.commands.at(-1).action, "resume");
  emit(c, "resumed");
  assert.equal(p.paused, false);
  p.stop();
  assert.equal(c.commands.at(-1).action, "stop");
  assert.equal(p.proc, null);
  await Promise.resolve();
  await p.speak("First reading");
  const first = p.proc;
  await p.speak("Second reading");
  const second = p.proc;
  emit(first, "finished");
  assert.equal(p.proc, second);
  second.stdout.emit("data", Buffer.from('{"event":"star'));
  second.stdout.emit("data", Buffer.from('ted"}\n'));
  p.stop();
  await Promise.resolve();
  await p.speak("Completion");
  c = p.proc;
  emit(c, "started");
  emit(c, "finished");
  c.exitCode = 0;
  c.emit("close", 0);
  assert.equal(p.proc, null);
  await p.speak("Classic works", "mac");
  c = p.proc;
  assert.equal(c.exe, "/usr/bin/say");
  assert.equal(fs.readFileSync(p.readPath, "utf8"), "Classic works");
  p.togglePause();
  p.togglePause();
  assert.deepEqual(c.signals, ["SIGSTOP", "SIGCONT"]);
  p.stop();
  assert.equal(c.signals.at(-1), "SIGKILL");
  let cloudText;
  p.speakCloud = (t) => (cloudText = t);
  await p.speak("Cloud remains available", "eleven");
  assert.equal(cloudText, "Cloud remains available");
  global.window = { getSelection: () => ({ toString: () => "" }) };
  const text =
    "# First\nFirst paragraph\n## Child\nChild text\n# Second\nSecond paragraph";
  let selected = "Selected text";
  const ed = {
    getSelection: () => selected,
    getValue: () => text,
    getCursor: () => ({ line: 1 }),
    posToOffset: () => 8,
  };
  p.app = {
    workspace: { getActiveViewOfType: () => ({ file: {}, editor: ed }) },
  };
  const realSpeak = p.speak;
  let read;
  p.speak = (t, provider) => (read = { t, provider });
  await p.readActive("smart", "native");
  assert.deepEqual(read, { t: "Selected text", provider: "native" });
  selected = "";
  await p.readActive("section");
  assert.equal(read.t, "# First\nFirst paragraph\n## Child\nChild text");
  await p.readActive("whole");
  assert.equal(read.t, text);
  await p.readActive("cursor");
  assert.equal(read.t, text.slice(8));
  p.speak = realSpeak;
  const tab = new Reader.ReaderSettings(p.app, p);
  tab.containerEl = {
    empty() {
      settings.length = 0;
    },
    createEl() {},
  };
  await tab.display();
  let service = settings.find((s) => s.name === "Narration service").dropdown;
  assert.equal(service.options.native, "Siri and enhanced Mac voices");
  let voices = settings.find((s) => s.name === "Siri or Mac voice").dropdown;
  assert.match(
    voices.options[p.settings.nativeVoice],
    /^Siri — Voice 2.*Enhanced$/,
  );
  p.settings.provider = "eleven";
  await tab.display();
  assert(settings.some((s) => s.name === "ElevenLabs API key"));
  assert(!settings.some((s) => s.name === "Siri or Mac voice"));
  cloudText = null;
  settings.find((s) => s.name === "Preview voice").button.click();
  assert.match(cloudText, /Readalong reads your notes/);
  p.settings.provider = "mac";
  await tab.display();
  assert(settings.some((s) => s.name === "Installed British voices"));
  assert(!settings.some((s) => s.name === "ElevenLabs API key"));
  p.stop();
  await Promise.resolve();
  assert.deepEqual(notices, []);
  runtimeError = new Error("No developer tools");
  const beforeMissing = spawned.length;
  await p.speak("Missing runtime", "native");
  assert.equal(spawned.length, beforeMissing);
  assert.match(notices.pop(), /Command Line Tools/);
  runtimeError = null;
  deferRuntime = true;
  const cancelled = p.speak("Cancelled during startup", "native");
  p.stop();
  pendingRuntime(null, "/mock-tools");
  await cancelled;
  assert.equal(
    spawned.length,
    beforeMissing,
    "Stop must cancel a pending native startup",
  );
  deferRuntime = false;
  assert.deepEqual(notices, []);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(
    "PASS: native routing, text cleaning, controls, completion, stale-process guards, classic/cloud routing, selection/section/whole/cursor scope, and all three settings panels.",
  );
})().catch((e) => {
  p.stop();
  console.error(e);
  process.exitCode = 1;
});
