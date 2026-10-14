// Readalong — Copyright © 2026 Tomas Gonzalez.
const {
  Plugin,
  PluginSettingTab,
  Setting,
  MarkdownView,
  Notice,
} = require("obsidian");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
let safeStorage;
try {
  safeStorage = require("electron").safeStorage;
} catch {}
function canSaveKey() {
  try {
    return (
      !!safeStorage?.isEncryptionAvailable() &&
      safeStorage.getSelectedStorageBackend?.() !== "basic_text"
    );
  } catch {
    return false;
  }
}

function cleanMarkdown(text) {
  return text
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, path, label) => label || path.split("/").pop().replace(/\.md$/, ""),
    )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/^\s*>\s*\[![^\]]+\]\s*/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\|/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function sectionAt(text, line) {
  const lines = text.split("\n");
  let start = 0,
    level = 0;
  for (let i = line; i >= 0; i--) {
    const m = lines[i]?.match(/^(#{1,6})\s+/);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  let end = lines.length;
  for (let i = Math.max(line + 1, start + 1); i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && (!level || m[1].length <= level)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}
module.exports = class Readalong extends Plugin {
  async onload() {
    this.settings = Object.assign(
      {
        voice: "Daniel",
        rate: 175,
        provider: process.platform === "darwin" ? "mac" : "eleven",
        elevenVoice: "",
        elevenName: "",
        audioSpeed: 1,
        nativeVoice: "com.apple.siri.natural.Simone",
        nativeRate: 0.47,
      },
      await this.loadData(),
    );
    this.proc = null;
    this.paused = false;
    this.readPath = path.join(
      this.app.vault.adapter.getBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
      "active-reading.txt",
    );
    this.dir = path.dirname(this.readPath);
    this.keyPath = path.join(this.dir, "eleven-key.enc");
    this.cacheDir = path.join(this.dir, "audio-cache");
    this.session = 0;
    this.active = false;
    this.apiKey = "";
    this.readKey();
    this.status = this.addStatusBarItem();
    this.cleanupOrphans();
    this.updateStatus();
    this.addRibbonIcon("headphones", "Read selection or section", () =>
      this.readActive("smart"),
    );
    this.addRibbonIcon("pause", "Pause or resume reader", () =>
      this.togglePause(),
    );
    this.addRibbonIcon("square", "Stop reader", () => this.stop());
    for (const [id, name, mode] of [
      ["read-selection-or-note", "Read selection or current section", "smart"],
      ["read-from-cursor", "Read from cursor to end", "cursor"],
      ["read-whole-note", "Read whole note", "whole"],
      ["read-current-section", "Read current section", "section"],
    ])
      this.addCommand({ id, name, callback: () => this.readActive(mode) });
    if (process.platform === "darwin")
      this.addCommand({
        id: "read-with-native-voice",
        name: "Read selection or current section with Siri or enhanced Mac voice",
        callback: () => this.readActive("smart", "native"),
      });
    this.addCommand({
      id: "pause-resume",
      name: "Pause or resume reading",
      callback: () => this.togglePause(),
    });
    this.addCommand({
      id: "stop",
      name: "Stop reading",
      callback: () => this.stop(),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle("Read selection aloud")
            .setIcon("headphones")
            .onClick(() =>
              this.speak(
                editor.getSelection() ||
                  sectionAt(editor.getValue(), editor.getCursor().line),
              ),
            ),
        );
      }),
    );
    this.addSettingTab(new ReaderSettings(this.app, this));
  }
  updateStatus() {
    if (!this.status) return;
    this.status.empty();
    if (this.proc || this.active) {
      if (this.generating)
        this.status.createSpan({
          text: this.paused ? "Generation paused " : "Generating audio ",
        });
      const toggle = this.status.createEl("button", {
        text: this.paused ? "Resume" : "Pause",
      });
      toggle.onclick = () => this.togglePause();
      const stop = this.status.createEl("button", { text: "Stop" });
      stop.onclick = () => this.stop();
    }
  }
  async readActive(mode, provider) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      new Notice("Open a Markdown note first.");
      return;
    }
    const editor = view.editor;
    let text;
    if (mode === "smart")
      text = editor?.getSelection() || window.getSelection()?.toString();
    if (!text) {
      const source =
        editor?.getValue() || (await this.app.vault.read(view.file));
      text =
        mode === "cursor" && editor
          ? source.slice(editor.posToOffset(editor.getCursor()))
          : mode === "whole"
            ? source
            : sectionAt(source, editor?.getCursor().line || 0);
    }
    this.speak(text, provider);
  }
  speak(text, provider = this.settings.provider) {
    if (provider === "native") return this.speakNative(text);
    if (provider === "eleven") {
      this.speakCloud(text);
      return;
    }
    if (process.platform !== "darwin") {
      new Notice(
        "Classic Mac voices require macOS. Choose ElevenLabs in Readalong settings on this computer.",
      );
      return;
    }
    const content = cleanMarkdown(text || "");
    if (!content) {
      new Notice("No readable text selected.");
      return;
    }
    this.stop();
    fs.writeFileSync(this.readPath, content, { encoding: "utf8", mode: 0o600 });
    const child = spawn(
      "/usr/bin/say",
      [
        "-v",
        this.settings.voice,
        "-r",
        String(this.settings.rate),
        "-f",
        this.readPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    this.proc = child;
    this.paused = false;
    this.updateStatus();
    let errors = "";
    child.stderr.on("data", (d) => {
      errors += d.toString().slice(0, 500);
    });
    child.on("error", (e) => {
      new Notice("Reader could not start: " + e.message);
      if (this.proc === child) {
        this.proc = null;
        this.updateStatus();
      }
    });
    child.on("close", (code) => {
      if (this.proc === child) {
        this.proc = null;
        this.paused = false;
        this.updateStatus();
        if (code && errors) new Notice("Reader: " + errors.trim());
      }
    });
  }
  async speakNative(text) {
    if (process.platform !== "darwin") {
      new Notice("Siri and enhanced Mac voices require macOS.");
      return;
    }
    const content = cleanMarkdown(text || "");
    if (!content) {
      new Notice("No readable text selected.");
      return;
    }
    this.stop();
    const token = this.session;
    try {
      await ensureNativeRuntime();
    } catch (error) {
      if (token === this.session) new Notice(error.message);
      return;
    }
    if (token !== this.session) return;
    const child = spawnNative(["--session", this.readPath]);
    child.readerBackend = "native";
    this.proc = child;
    this.paused = false;
    this.updateStatus();
    let pending = "",
      errors = "",
      reported = false;
    const startTimer = setTimeout(() => {
      if (this.proc === child) {
        new Notice(
          "The selected Mac voice did not start. Try refreshing voices in reader settings.",
        );
        this.stop();
      }
    }, 20000);
    startTimer.unref?.();
    child.once("close", () => clearTimeout(startTimer));
    child.stderr.on("data", (data) => {
      errors = (errors + data.toString()).slice(-2000);
    });
    const report = (message) => {
      if (this.proc !== child || reported) return;
      reported = true;
      clearTimeout(startTimer);
      new Notice(message);
      this.stop();
    };
    child.on("error", (error) =>
      report("Reader could not start: " + error.message),
    );
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE")
        report("Reader connection failed: " + error.message);
    });
    child.stdout.on("data", (data) => {
      pending += data.toString();
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (this.proc !== child) continue;
        if (event.event === "started") {
          clearTimeout(startTimer);
        } else if (event.event === "paused") this.paused = true;
        else if (event.event === "resumed") this.paused = false;
        else if (event.event === "error") {
          report(
            event.message || "The selected voice could not read this text.",
          );
          continue;
        } else if (event.event === "finished" || event.event === "stopped") {
          clearTimeout(startTimer);
          this.proc = null;
          this.paused = false;
        }
        this.updateStatus();
      }
    });
    child.on("close", (code) => {
      if (this.proc !== child) return;
      this.proc = null;
      this.paused = false;
      this.updateStatus();
      if (code && !reported)
        new Notice(
          "Native voice reader stopped unexpectedly" +
            (errors ? ": " + errors.trim() : "."),
        );
    });
    child.stdin.write(
      JSON.stringify({
        action: "speak",
        text: content,
        voice: this.settings.nativeVoice,
        rate: this.settings.nativeRate,
      }) + "\n",
    );
  }
  togglePause() {
    if (this.active) {
      this.paused = !this.paused;
      if (this.audio) {
        if (this.paused) this.audio.pause();
        else
          this.audio.play().catch(() => {
            new Notice("Audio could not resume.");
            this.stop();
          });
      }
      if (!this.paused && this.resumeWait) {
        this.resumeWait();
        this.resumeWait = null;
      }
      this.updateStatus();
      return;
    }
    if (!this.proc) {
      new Notice("Nothing is playing.");
      return;
    }
    if (this.proc.readerBackend === "native") {
      this.paused = !this.paused;
      this.proc.stdin.write(
        JSON.stringify({ action: this.paused ? "pause" : "resume" }) + "\n",
      );
      this.updateStatus();
      return;
    }
    try {
      this.proc.kill(this.paused ? "SIGCONT" : "SIGSTOP");
      this.paused = !this.paused;
      this.updateStatus();
    } catch (e) {
      new Notice("Could not change playback: " + e.message);
    }
  }
  stop() {
    this.session = (this.session || 0) + 1;
    this.active = false;
    this.generating = false;
    if (this.request) {
      this.request.destroy(new Error("Reading stopped."));
      this.request = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    if (this.finishAudio) {
      this.finishAudio();
      this.finishAudio = null;
    }
    if (this.resumeWait) {
      this.resumeWait();
      this.resumeWait = null;
    }
    const old = this.proc;
    this.proc = null;
    this.paused = false;
    if (old) {
      try {
        if (old.readerBackend === "native") {
          old.stdin.end(JSON.stringify({ action: "stop" }) + "\n");
          const timer = setTimeout(() => {
            if (old.exitCode === null) old.kill("SIGKILL");
          }, 1500);
          timer.unref?.();
          old.once("close", () => clearTimeout(timer));
        } else old.kill("SIGKILL");
      } catch {
        try {
          old.kill("SIGTERM");
        } catch {}
      }
    }
    this.updateStatus();
    this.cleanupOrphans();
  }
  cleanupOrphans() {
    if (process.platform !== "darwin" || !this.readPath) return;
    const expected = this.readPath;
    const currentPid = this.proc?.pid;
    execFile(
      "/bin/ps",
      ["-axo", "pid=,args="],
      { encoding: "utf8" },
      (error, out) => {
        if (error) return;
        for (const line of out.split("\n")) {
          const match = line.trim().match(/^(\d+)\s+(.*)$/);
          if (!match) continue;
          const pid = Number(match[1]);
          if (pid === currentPid || pid === this.proc?.pid) continue;
          const command = match[2];
          const classic =
            command.startsWith("/usr/bin/say ") &&
            command.endsWith(" -f " + expected);
          const native =
            command.includes(" -interpret /dev/fd/3 ") &&
            command.endsWith(" --session " + expected);
          if (classic || native) {
            try {
              process.kill(pid, native ? "SIGTERM" : "SIGKILL");
            } catch {}
          }
        }
      },
    );
  }
  readKey() {
    try {
      if (canSaveKey() && fs.existsSync(this.keyPath))
        this.apiKey = safeStorage.decryptString(fs.readFileSync(this.keyPath));
    } catch {
      new Notice("Saved ElevenLabs key could not be opened; enter it again.");
    }
  }
  saveKey(key) {
    this.apiKey = key.trim();
    if (canSaveKey()) {
      if (this.apiKey)
        fs.writeFileSync(this.keyPath, safeStorage.encryptString(this.apiKey), {
          mode: 0o600,
        });
      else if (fs.existsSync(this.keyPath)) fs.unlinkSync(this.keyPath);
      return true;
    }
    return false;
  }
  apiRequest(endpoint, body) {
    return new Promise((resolve, reject) => {
      if (!this.apiKey)
        return reject(
          new Error("Add your ElevenLabs API key in reader settings."),
        );
      const payload = body ? JSON.stringify(body) : null;
      const request = https.request(
        {
          hostname: "api.elevenlabs.io",
          path: endpoint,
          method: body ? "POST" : "GET",
          headers: {
            "xi-api-key": this.apiKey,
            ...(body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (response) => {
          let bytes = 0;
          const chunks = [];
          response.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > 25 * 1024 * 1024) {
              request.destroy(new Error("Audio response was too large."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              const messages = {
                401: "API key was rejected.",
                403: "Key or plan lacks permission for this voice or operation.",
                429: "ElevenLabs usage or rate limit reached.",
              };
              reject(
                new Error(
                  messages[response.statusCode] ||
                    "ElevenLabs request failed (HTTP " +
                      response.statusCode +
                      ").",
                ),
              );
            } else resolve(Buffer.concat(chunks));
          });
        },
      );
      this.request = request;
      request.setTimeout(90000, () =>
        request.destroy(new Error("ElevenLabs request timed out.")),
      );
      request.on("error", reject);
      request.on("close", () => {
        if (this.request === request) this.request = null;
      });
      if (payload) request.write(payload);
      request.end();
    });
  }
  async listCloudVoices() {
    this.stop();
    try {
      const data = JSON.parse(
        (await this.apiRequest("/v2/voices?page_size=100")).toString(),
      );
      this.cloudVoices = data.voices || [];
      new Notice("Loaded " + this.cloudVoices.length + " account voices.");
      return this.cloudVoices;
    } catch (e) {
      new Notice(e.message);
      return [];
    }
  }
  async speakCloud(text) {
    const content = cleanMarkdown(text || "");
    if (!content) {
      new Notice("No readable text selected.");
      return;
    }
    if (!this.apiKey || !this.settings.elevenVoice) {
      new Notice(
        "Add an ElevenLabs key and select a voice in reader settings.",
      );
      return;
    }
    this.stop();
    const token = this.session;
    this.active = true;
    this.paused = false;
    const voice = this.settings.elevenVoice;
    fs.mkdirSync(this.cacheDir, { recursive: true });
    try {
      for (const chunk of splitSpeech(content)) {
        if (token !== this.session) return;
        if (this.paused)
          await new Promise((resolve) => (this.resumeWait = resolve));
        if (token !== this.session) return;
        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify(["eleven_multilingual_v2", voice, chunk]))
          .digest("hex");
        const file = path.join(this.cacheDir, hash + ".mp3");
        let bytes;
        if (fs.existsSync(file)) bytes = fs.readFileSync(file);
        else {
          this.generating = true;
          this.updateStatus();
          bytes = await this.apiRequest(
            "/v1/text-to-speech/" +
              encodeURIComponent(voice) +
              "?output_format=mp3_44100_128",
            { text: chunk, model_id: "eleven_multilingual_v2" },
          );
          if (token !== this.session) return;
          fs.writeFileSync(file, bytes, { mode: 0o600 });
        }
        this.generating = false;
        if (this.paused)
          await new Promise((resolve) => (this.resumeWait = resolve));
        if (token !== this.session) return;
        await this.playAudio(bytes, token);
        if (token !== this.session) return;
      }
      if (token === this.session) this.stop();
    } catch (e) {
      if (token === this.session) {
        new Notice(e.message);
        this.stop();
      }
    }
  }
  playAudio(bytes, token) {
    return new Promise((resolve, reject) => {
      this.audioUrl = URL.createObjectURL(
        new Blob([bytes], { type: "audio/mpeg" }),
      );
      const audio = new Audio(this.audioUrl);
      this.audio = audio;
      audio.playbackRate = this.settings.audioSpeed;
      this.finishAudio = resolve;
      audio.onended = () => {
        if (token !== this.session) return;
        URL.revokeObjectURL(this.audioUrl);
        this.audioUrl = null;
        this.audio = null;
        this.finishAudio = null;
        resolve();
      };
      audio.onerror = () =>
        reject(new Error("Generated audio could not play."));
      this.updateStatus();
      audio.play().catch(reject);
    });
  }
  clearCache() {
    this.stop();
    if (fs.existsSync(this.cacheDir))
      for (const name of fs.readdirSync(this.cacheDir))
        if (/^[a-f0-9]{64}\.mp3$/.test(name))
          fs.unlinkSync(path.join(this.cacheDir, name));
    new Notice("Saved reader audio cleared.");
  }
  onunload() {
    this.stop();
  }
};
function splitSpeech(text, max = 2200) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > max) {
    let at = remaining.lastIndexOf("\n", max);
    if (at < max / 2) at = remaining.lastIndexOf(". ", max) + 1;
    if (at < max / 2) at = remaining.lastIndexOf(" ", max);
    if (at < 1) at = max;
    chunks.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
function britishVoices() {
  return new Promise((resolve, reject) =>
    execFile(
      "/usr/bin/say",
      ["-v", "?"],
      { encoding: "utf8" },
      (error, out) => {
        if (error) return reject(error);
        resolve([
          ...new Set(
            out
              .split("\n")
              .map((line) => line.match(/^(.*?)\s+en_GB\s+#/))
              .filter(Boolean)
              .map((match) => match[1].trim()),
          ),
        ]);
      },
    ),
  );
}
// The reviewed Swift source is bundled in main.js and passed through an inherited
// pipe. Nothing is downloaded, installed or written as executable code at runtime.
function ensureNativeRuntime() {
  return new Promise((resolve, reject) =>
    execFile(
      "/usr/bin/xcode-select",
      ["-p"],
      { encoding: "utf8", timeout: 3000 },
      (error) => {
        if (error)
          return reject(
            new Error(
              "Siri and enhanced voices need Apple’s Command Line Tools or Xcode. Install them yourself, then refresh voices; classic Mac voices work without them.",
            ),
          );
        resolve();
      },
    ),
  );
}
function spawnNative(args) {
  const child = spawn("/usr/bin/swift", ["/dev/fd/3", ...args], {
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });
  child.stdio[3].on("error", () => {}); // A failed process is reported through error/close.
  child.stdio[3].end(NATIVE_READER_SOURCE);
  return child;
}
async function nativeVoices() {
  await ensureNativeRuntime();
  return new Promise((resolve, reject) => {
    const child = spawnNative(["--list"]);
    let out = "",
      errors = "",
      settled = false;
    const finish = (error, voices) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(voices);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Native voice discovery timed out."));
    }, 10000);
    child.stdin.on("error", () => {});
    child.stdin.end();
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (data) => {
      out += data.toString();
      if (out.length > 1024 * 1024) {
        child.kill("SIGTERM");
        finish(new Error("The native voice list was too large."));
      }
    });
    child.stderr.on("data", (data) => {
      errors = (errors + data.toString()).slice(-2000);
    });
    child.on("close", (code) => {
      if (code)
        return finish(
          new Error(errors.trim() || "Could not load native voices."),
        );
      try {
        const voices = JSON.parse(out);
        if (
          !Array.isArray(voices) ||
          voices.some(
            (v) =>
              typeof v.id !== "string" ||
              typeof v.name !== "string" ||
              typeof v.language !== "string",
          )
        )
          throw new Error("Invalid voice list");
        voices.sort(
          (a, b) =>
            Number(b.siri) - Number(a.siri) ||
            Number(b.language.startsWith("en-")) -
              Number(a.language.startsWith("en-")) ||
            b.quality - a.quality ||
            a.language.localeCompare(b.language) ||
            a.name.localeCompare(b.name),
        );
        finish(null, voices);
      } catch (error) {
        finish(error);
      }
    });
  });
}
function nativeVoiceLabel(voice) {
  return (
    (voice.siri ? "Siri — " : "") +
    voice.name +
    " · " +
    voice.language +
    " · " +
    ({ 1: "Standard", 2: "Enhanced", 3: "Premium" }[voice.quality] ||
      "Mac voice")
  );
}
class ReaderSettings extends PluginSettingTab {
  async display() {
    const renderId = (this.renderId = (this.renderId || 0) + 1);
    const c = this.containerEl,
      p = this.plugin;
    c.empty();
    c.createEl("h2", { text: "Readalong" });
    const services =
      process.platform === "darwin"
        ? [
            ["native", "Siri and enhanced Mac voices"],
            ["mac", "Classic Mac voice"],
            ["eleven", "ElevenLabs"],
          ]
        : [["eleven", "ElevenLabs"]];
    const available = services.some(([id]) => id === p.settings.provider);
    new Setting(c).setName("Narration service").addDropdown((d) => {
      if (!available) d.addOption("", "Choose a narration service");
      for (const [id, label] of services) d.addOption(id, label);
      d.setValue(available ? p.settings.provider : "").onChange(
        async (value) => {
          if (!services.some(([id]) => id === value)) return;
          p.stop();
          p.settings.provider = value;
          await p.saveData(p.settings);
          this.display();
        },
      );
    });
    if (!available) {
      c.createEl("p", {
        text:
          process.platform !== "darwin" &&
          ["native", "mac"].includes(p.settings.provider)
            ? "Your saved voice service requires macOS. Choose ElevenLabs above to read on this computer."
            : "Choose a narration service to continue.",
      });
      return;
    }
    if (p.settings.provider === "eleven") {
      cloudSettings(this);
      new Setting(c)
        .setName("Preview voice")
        .addButton((b) =>
          b
            .setButtonText("Listen")
            .onClick(() =>
              p.speak(
                "Readalong reads your notes aloud. Select a passage, choose a voice, and listen.",
                "eleven",
              ),
            ),
        );
      return;
    }
    if (p.settings.provider === "native") {
      c.createEl("p", {
        text: "Reads locally using installed Siri and Mac voices. Available voices depend on this Mac. No API key is needed.",
      });
      let voices = [];
      try {
        voices = await nativeVoices();
      } catch (error) {
        if (this.renderId === renderId)
          c.createEl("p", { text: error.message });
      }
      if (this.renderId !== renderId) return;
      new Setting(c)
        .setName("Siri or Mac voice")
        .setDesc(
          "Choose an installed voice. Enhanced and Premium labels indicate the quality reported by macOS.",
        )
        .addDropdown((d) => {
          if (!voices.some((v) => v.id === p.settings.nativeVoice))
            d.addOption(
              p.settings.nativeVoice,
              "Selected voice unavailable — refresh or choose another",
            );
          for (const voice of voices)
            d.addOption(voice.id, nativeVoiceLabel(voice));
          d.setValue(p.settings.nativeVoice).onChange(async (value) => {
            p.stop();
            p.settings.nativeVoice = value;
            await p.saveData(p.settings);
          });
        });
      new Setting(c)
        .setName("Refresh voices")
        .setDesc(
          "Refresh after installing additional voices in macOS Accessibility settings.",
        )
        .addButton((b) =>
          b.setButtonText("Refresh").onClick(() => this.display()),
        );
      new Setting(c)
        .setName("Speaking speed")
        .setDesc(
          "Adjust the speaking pace. This scale is separate from classic Mac words per minute.",
        )
        .addSlider((sl) =>
          sl
            .setLimits(0.2, 0.65, 0.01)
            .setValue(p.settings.nativeRate)
            .setDynamicTooltip()
            .onChange(async (value) => {
              p.settings.nativeRate = value;
              await p.saveData(p.settings);
            }),
        );
      new Setting(c)
        .setName("Preview voice")
        .addButton((b) =>
          b
            .setButtonText("Listen")
            .onClick(() =>
              p.speak(
                "Readalong reads your notes aloud. Select a passage, choose a voice, and listen.",
                "native",
              ),
            ),
        );
      return;
    }
    c.createEl("p", {
      text: "Uses classic macOS speech voices. Select Siri and enhanced Mac voices above for the more natural Siri option.",
    });
    let voices = [];
    try {
      voices = await britishVoices();
    } catch {
      if (this.renderId === renderId)
        c.createEl("p", {
          text: "Could not list voices. You can still enter an installed voice name below.",
        });
    }
    if (this.renderId !== renderId) return;
    if (voices.length)
      new Setting(c).setName("Installed British voices").addDropdown((d) => {
        d.addOption(p.settings.voice, p.settings.voice);
        for (const voice of voices) d.addOption(voice, voice);
        d.setValue(p.settings.voice).onChange(async (value) => {
          p.stop();
          p.settings.voice = value;
          await p.saveData(p.settings);
        });
      });
    new Setting(c)
      .setName("Refresh voices")
      .addButton((b) =>
        b.setButtonText("Refresh").onClick(() => this.display()),
      );
    new Setting(c)
      .setName("Other installed voice")
      .setDesc("Enter the exact name of another classic Mac voice.")
      .addText((t) =>
        t.setValue(p.settings.voice).onChange(async (value) => {
          p.settings.voice = value.trim() || "Daniel";
          await p.saveData(p.settings);
        }),
      );
    new Setting(c)
      .setName("Reading speed")
      .setDesc("Words per minute.")
      .addSlider((sl) =>
        sl
          .setLimits(100, 260, 5)
          .setValue(p.settings.rate)
          .setDynamicTooltip()
          .onChange(async (value) => {
            p.settings.rate = value;
            await p.saveData(p.settings);
          }),
      );
    new Setting(c)
      .setName("Preview voice")
      .addButton((b) =>
        b
          .setButtonText("Listen")
          .onClick(() =>
            p.speak(
              "Readalong reads your notes aloud. Select a passage, choose a voice, and listen.",
              "mac",
            ),
          ),
      );
  }
}
module.exports.cleanMarkdown = cleanMarkdown;
module.exports.sectionAt = sectionAt;

function cloudSettings(tab) {
  const p = tab.plugin,
    c = tab.containerEl;
  c.createEl("p", {
    text: "ElevenLabs sends the selected text for narration when you press Play. Generation uses your account allowance. Audio is saved locally for replay; you can clear it below.",
  });
  new Setting(c)
    .setName("ElevenLabs API key")
    .setDesc(
      canSaveKey()
        ? "Saved encrypted using Electron secure storage, separately from note settings."
        : "Kept in memory for this Obsidian session only; enter again after restarting.",
    )
    .addText((t) => {
      t.inputEl.type = "password";
      t.inputEl.autocomplete = "off";
      t.setValue(p.apiKey || "").onChange((v) => p.saveKey(v));
    });
  new Setting(c)
    .setName("Load ElevenLabs voices")
    .setDesc(
      "Uses voice-list permission. Add a voice to My Voices in ElevenLabs first.",
    )
    .addButton((b) =>
      b.setButtonText("Load voices").onClick(async () => {
        await p.listCloudVoices();
        tab.display();
      }),
    );
  const voices = p.cloudVoices || [];
  if (voices.length)
    new Setting(c).setName("Account voice").addDropdown((d) => {
      d.addOption("", "Choose a voice");
      if (p.settings.elevenVoice)
        d.addOption(
          p.settings.elevenVoice,
          p.settings.elevenName || p.settings.elevenVoice,
        );
      for (const v of voices)
        d.addOption(
          v.voice_id,
          v.name + (v.labels?.accent ? " — " + v.labels.accent : ""),
        );
      d.setValue(p.settings.elevenVoice).onChange(async (id) => {
        p.stop();
        p.settings.elevenVoice = id;
        p.settings.elevenName =
          voices.find((v) => v.voice_id === id)?.name || id;
        await p.saveData(p.settings);
      });
    });
  new Setting(c)
    .setName("Voice ID")
    .setDesc(
      "Paste the ID from ElevenLabs if the voice is not in the loaded list.",
    )
    .addText((t) =>
      t.setValue(p.settings.elevenVoice).onChange(async (id) => {
        p.settings.elevenVoice = id.trim();
        p.settings.elevenName = "";
        await p.saveData(p.settings);
      }),
    );
  new Setting(c)
    .setName("ElevenLabs playback speed")
    .setDesc("Changes playback speed without regenerating saved audio.")
    .addSlider((sl) =>
      sl
        .setLimits(0.75, 1.25, 0.05)
        .setValue(p.settings.audioSpeed)
        .setDynamicTooltip()
        .onChange(async (speed) => {
          p.settings.audioSpeed = speed;
          if (p.audio) p.audio.playbackRate = speed;
          await p.saveData(p.settings);
        }),
    );
  new Setting(c)
    .setName("Saved audio")
    .setDesc(
      "Stored in the plugin audio-cache folder. Replaying unchanged text with the same voice reuses saved audio.",
    )
    .addButton((b) =>
      b.setButtonText("Clear saved audio").onClick(() => p.clearCache()),
    );
}
module.exports.splitSpeech = splitSpeech;

module.exports.nativeVoiceLabel = nativeVoiceLabel;
