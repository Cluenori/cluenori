import CluenoriClient
import Foundation
import Observation

/// Why a question to the deployment couldn't be asked.
public enum AnswerProblem: Equatable, Sendable {
    /// The deployment didn't answer: the phone may be offline.
    case unreachable
    /// The deployment has no such thing, at least in the period asked about: an error that didn't
    /// happen then, a project since removed, a release it doesn't count, a person the apps never
    /// sent.
    case missing
    /// The deployment answered in a way this app doesn't understand, such as from a newer version.
    case unreadable
}

/// Where answers are kept on the phone between launches, and the choices made on them: one file per
/// question or choice, in a folder of the pairing's own, which goes when the phone unpairs. Without a
/// folder, nothing is kept.
struct AnswerStore {
    let folder: URL?

    private struct Kept<Value: Codable>: Codable {
        let value: Value
        let receivedAt: Date
    }

    private func file(_ key: String) -> URL? {
        guard let folder, let name = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else {
            return nil
        }
        return folder.appending(path: "\(name).json")
    }

    /// What was kept for `key`, and when it arrived; nil when nothing was, or it can't be read.
    func read<Value: Codable>(_ type: Value.Type, _ key: String) -> (value: Value, receivedAt: Date)? {
        guard let file = file(key), let data = try? Data(contentsOf: file),
            let kept = try? JSONDecoder().decode(Kept<Value>.self, from: data)
        else {
            return nil
        }
        return (kept.value, kept.receivedAt)
    }

    /// Keeps `value` for `key`. Not kept, the next launch waits for the answer instead of showing
    /// it at once; nothing else, so a failure is let go.
    func write<Value: Codable>(_ value: Value, receivedAt: Date, _ key: String) {
        guard let folder, let file = file(key) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? JSONEncoder().encode(Kept(value: value, receivedAt: receivedAt)).write(to: file, options: .atomic)
    }

    /// Forgets every answer kept for the pairing.
    func removeAll() {
        guard let folder else { return }
        try? FileManager.default.removeItem(at: folder)
    }
}

/// What every question shares: where its answers are kept, and what to do when the deployment
/// refuses the phone's key.
struct AnswerContext {
    let store: AnswerStore
    let keyRejected: () -> Void
}

/// One question to the deployment, and its answer: shown at once when the phone kept one from
/// before, asked again by `load`, and kept when asking fails, with `problem` saying why. A refused
/// key unpairs the phone.
@Observable
public final class Answer<Value: Codable & Equatable & Sendable> {
    /// The answer; nil until one arrives or is read from the phone.
    public private(set) var value: Value? = nil
    /// When the answer shown arrived from the deployment.
    public private(set) var receivedAt: Date? = nil
    public private(set) var problem: AnswerProblem? = nil
    public private(set) var isLoading = false

    /// The question: its key, under which its answer is kept, and how to ask it.
    struct Question {
        let key: String
        let ask: () async throws(APIError) -> Value
    }

    @ObservationIgnored private let context: AnswerContext
    @ObservationIgnored private var question: Question

    init(_ context: AnswerContext, _ question: Question) {
        self.context = context
        self.question = question
        showKept()
    }

    /// Asks the question. An answer to a question since changed is let go.
    public func load() async {
        _ = try? await answer()
    }

    /// Asks the question as `load` does, and returns its answer, or throws why it couldn't be had.
    func answer() async throws(APIError) -> Value {
        let asked = question
        isLoading = true
        defer { isLoading = false }
        do {
            let answer = try await asked.ask()
            guard asked.key == question.key else { return answer }
            let now = Date.now
            value = answer
            receivedAt = now
            problem = nil
            context.store.write(answer, receivedAt: now, asked.key)
            return answer
        } catch {
            guard asked.key == question.key else { throw error }
            switch error {
            case .unauthorized:
                context.keyRejected()
            case .unreachable:
                problem = .unreachable
            case .projectNotFound, .componentNotFound, .errorGroupNotFound, .incidentNotFound, .monitorNotFound,
                .releaseNotFound, .personNotFound:
                problem = .missing
            default:
                problem = .unreadable
            }
            throw error
        }
    }

    /// Shows `value` as the answer, as a write's answer says it is now, and keeps it on the phone, as
    /// if the question had been asked.
    func show(_ value: Value) {
        let now = Date.now
        self.value = value
        receivedAt = now
        problem = nil
        context.store.write(value, receivedAt: now, question.key)
    }

    /// Changes the question, such as to another period, showing what the phone kept for it, if
    /// anything, until `load` asks it.
    func change(to next: Question) {
        guard next.key != question.key else { return }
        question = next
        problem = nil
        showKept()
    }

    private func showKept() {
        let kept = context.store.read(Value.self, question.key)
        value = kept?.value
        receivedAt = kept?.receivedAt
    }
}
