// Readalong — Copyright © 2026 Tomas Gonzalez.
import Foundation
import AVFoundation
import CoreFoundation
import Darwin

// One process per reading. Commands and events are newline-delimited JSON.
// Speech text arrives through stdin, never through command-line arguments.
func emit(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event),
          let text = String(data: data, encoding: .utf8) else { return }
    print(text)
    fflush(stdout)
}

func fail(_ message: String) -> Never {
    emit(["event": "error", "message": message])
    exit(1)
}

let arguments = CommandLine.arguments
if arguments.count == 2 && arguments[1] == "--list" {
    let records: [[String: Any]] = AVSpeechSynthesisVoice.speechVoices().map { voice in
        let quality = voice.quality.rawValue
        return ["id": voice.identifier, "name": voice.name, "language": voice.language,
                "quality": quality, "siri": voice.identifier.contains(".siri.")]
    }
    let data = try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(0)
}

guard arguments.count == 3 && arguments[1] == "--session" else {
    fail("Usage: native-reader --list or native-reader --session <reader tag>")
}

// All synthesizer and reader state is accessed on the main queue.
final class Reader: NSObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
    let synthesizer = AVSpeechSynthesizer()
    var started = false
    var stopping = false
    var desiredPaused = false
    var signals: [DispatchSourceSignal] = []

    override init() {
        super.init()
        synthesizer.delegate = self
        // A stale helper must stop its audio as well as its process.
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { [weak self] in self?.stop() }
            source.resume()
            signals.append(source)
        }
    }

    func command(_ command: [String: Any]) {
        guard !stopping else { return }
        switch command["action"] as? String {
        case "speak":
            guard !started else { fail("A reading is already active.") }
            guard let text = command["text"] as? String,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                fail("No readable text selected.")
            }
            guard let identifier = command["voice"] as? String,
                  let voice = AVSpeechSynthesisVoice(identifier: identifier) else {
                fail("The selected Siri or Mac voice is unavailable. Refresh voices in reader settings.")
            }
            guard let rate = command["rate"] as? Double, rate.isFinite,
                  rate >= 0.1 && rate <= 0.7 else { fail("The speaking rate is invalid.") }
            started = true
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = voice
            utterance.rate = Float(rate)
            synthesizer.speak(utterance)
        case "pause":
            desiredPaused = true
            if synthesizer.isSpeaking { _ = synthesizer.pauseSpeaking(at: .immediate) }
        case "resume":
            desiredPaused = false
            if synthesizer.isPaused { _ = synthesizer.continueSpeaking() }
        case "stop":
            stop()
        default:
            fail("Unknown reader command.")
        }
    }

    func stop() {
        guard !stopping else { return }
        stopping = true
        _ = synthesizer.stopSpeaking(at: .immediate)
        emit(["event": "stopped"])
        // Give the speech service a moment to consume cancellation before exit.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { exit(0) }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        emit(["event": "started", "voice": utterance.voice?.identifier ?? ""])
        if desiredPaused { _ = synthesizer.pauseSpeaking(at: .immediate) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didPause utterance: AVSpeechUtterance) {
        emit(["event": "paused"])
        if !desiredPaused { _ = synthesizer.continueSpeaking() }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didContinue utterance: AVSpeechUtterance) {
        emit(["event": "resumed"])
        if desiredPaused { _ = synthesizer.pauseSpeaking(at: .immediate) }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard !stopping else { return }
        emit(["event": "finished"])
        exit(0)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        if !stopping { stop() }
    }
}

let reader = Reader()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              let command = value as? [String: Any] else {
            DispatchQueue.main.async { fail("Invalid reader command.") }
            return
        }
        DispatchQueue.main.async { reader.command(command) }
    }
    // Closing the parent pipe cancels speech, including when Obsidian exits.
    DispatchQueue.main.async { reader.stop() }
}
emit(["event": "ready"])
CFRunLoopRun()
