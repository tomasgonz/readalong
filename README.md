# Readalong

Listen to your Obsidian notes, one passage at a time.

Readalong reads a selection, the current section, the rest of a note, or the whole note. Use local voices on macOS, or connect your own ElevenLabs account. Pause, resume and stop from the ribbon, status bar or command palette.

Created and maintained by **Tomas Gonzalez**.

## Voice options

| Service | macOS | Windows / Linux desktop | Requirements |
| --- | --- | --- | --- |
| Classic Mac voice | Yes | No | An installed macOS voice |
| Siri and enhanced Mac voices | Yes | No | Installed voices and Apple's Command Line Tools or Xcode |
| ElevenLabs | Yes | Yes, pending real-device playback validation | Your own API key, voice and account allowance |

Readalong is desktop-only. Settings show services available on the current operating system. If synced settings select a Mac service on Windows or Linux, choose another service explicitly; Readalong never silently switches a local reading to the cloud.

Siri availability varies by macOS version, installed voices and Apple's speech runtime. If a voice isn't exposed on your Mac, select another installed voice. The plugin does not download voices or install developer tools.

## Installation

### Manual installation

1. Download `readalong.zip` from the [latest release](https://github.com/tomasgonz/readalong/releases/latest).
2. Extract its contents into `<your vault>/.obsidian/plugins/readalong/`. `main.js` and `manifest.json` must sit directly inside that folder.
3. In Obsidian, open **Settings → Community plugins**, reload the plugin list, and enable **Readalong**.
4. Open **Settings → Readalong** and choose a narration service.

Keep existing `data.json`, encrypted keys and `audio-cache` files when updating. No separate helper download or executable permission change is required.

### Community directory

Readalong is being prepared for the Obsidian Community directory. It is not yet listed; use the manual release until the listing is approved.

## Read a note

Select text and click the headphones icon, or place the cursor inside a section to read that section. In reading view, select visible text first. The command palette offers:

- **Read selection or current section**
- **Read from cursor to end**
- **Read whole note**
- **Read current section**
- **Pause or resume reading**
- **Stop reading**

On macOS, **Read selection or current section with Siri or enhanced Mac voice** uses the selected native voice without changing the saved narration service. Right-click a selection in the editor for **Read selection aloud**. Assign shortcuts in **Settings → Hotkeys**.

Starting another reading replaces the current one. Section reading includes subsections and ends at the next heading of equal or higher level. Use editing view for cursor-based section selection.

Markdown formatting, frontmatter, code blocks, embedded images and raw URLs are omitted. Link labels are spoken. Tables and mathematical notation are read as text; Readalong does not interpret formulas.

## Set up voices

### Local macOS voices

Choose **Classic Mac voice** for a local voice without developer tools. Choose **Siri and enhanced Mac voices** for voices exposed by Apple's native speech API. If the native service reports missing developer tools, install Apple's Command Line Tools or Xcode yourself, or use a classic voice.

Install additional voices through [macOS Accessibility voice settings](https://support.apple.com/guide/mac-help/mchlp2290/mac), then click **Refresh** in Readalong. Choose an installed voice and click **Listen**. Classic speech uses words per minute; native speech uses Apple's separate rate scale.

### ElevenLabs

1. Create an ElevenLabs API key with text-to-speech permission and, for voice discovery, voice-list permission.
2. In **Settings → Readalong**, select **ElevenLabs** and enter your key.
3. Load your account's voices and choose one, or paste a voice ID.
4. Click **Listen** to preview. This generates speech and uses your account allowance.

The integration uses Eleven Multilingual v2. Voice access and usage charges depend on your ElevenLabs account. Playback speed changes do not regenerate audio. The voice list shows up to 100 account voices; paste an ID if your voice is absent.

## Privacy, storage and system access

- **Local voices:** narration runs through Apple's installed speech tools. Readalong makes no network request for local narration.
- **ElevenLabs:** loading voices sends an authenticated voice-list request to `api.elevenlabs.io`. Starting a reading or preview sends its cleaned text to that service. Opening a note or changing a setting does not send its text. Review [ElevenLabs' privacy policy](https://elevenlabs.io/privacy-policy) before sending sensitive material.
- **Keys:** when Electron secure storage is available, the key is encrypted in `eleven-key.enc`. Otherwise it is held only for the current Obsidian session. Keys are not saved in `data.json`. The settings panel states which storage mode is active.
- **Saved audio:** generated MP3s are stored in the plugin's `audio-cache` directory and reused for identical requests. Use **Clear saved audio** to remove them. Classic Mac narration stages the passage in `active-reading.txt`; that file can retain the last passage. These files can contain note content and may be included in vault sync or backups.
- **System access:** macOS narration invokes `/usr/bin/say`, `/usr/bin/swift` and `/usr/bin/xcode-select`. The Swift source is bundled in `main.js` and passed through a local pipe, without creating or downloading executable files. Apple's tools access installed voices, frameworks and their own compiler caches outside the vault. `/bin/ps` identifies only this plugin's tagged speech processes for cleanup.
- **No telemetry:** Readalong adds no analytics or advertising. It does not install or update itself, developer tools, voices or other dependencies.

Stop cancels pending playback and requests. An ElevenLabs request already received by the service may still count toward your allowance.

## Compatibility and testing

Tested with Obsidian 1.14.4 on macOS. Native speech checks cover voice discovery, start, completion, pause, resume, stop, cancellation when the parent closes, and unavailable voices.

Automated tests cover platform-specific services, explicit cloud selection, reading scope, cache reuse and playback cancellation. Windows and Linux playback still needs testing in Obsidian on those systems; automated checks do not establish audio compatibility there.

## Development

The source is in `src/main.cjs` and `src/native-reader.swift`. The reproducible build bundles both into the readable release file `main.js`. There are no npm runtime dependencies.

```sh
npm run build
npm test
```

On a Mac with installed voices and Apple developer tools, run the optional audible integration test:

```sh
npm run test:native
```

Create the manual installation ZIP with `python3 scripts/package_release.py`. Report reproducible bugs through [GitHub Issues](https://github.com/tomasgonz/readalong/issues), including your Obsidian/macOS version and selected service. Do not include keys or private note content.

## License

[MIT License](LICENSE). Copyright © 2026 Tomas Gonzalez.
