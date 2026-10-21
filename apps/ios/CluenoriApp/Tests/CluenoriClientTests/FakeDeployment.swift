import CluenoriClient
import Foundation
import Synchronization

/// A deployment for tests: answers each request by its method and path, 404 for any other, and keeps
/// every request it got.
final class FakeDeployment: Sendable {
    struct Answer: Sendable {
        let status: Int
        let body: String
    }

    private let answers: Mutex<[String: Answer]>
    private let received = Mutex<[URLRequest]>([])

    init(_ answers: [String: Answer] = [:]) {
        self.answers = Mutex(answers)
    }

    /// Answers `request` with `answer` from now on: `"GET /api/projects"`.
    func answer(_ request: String, _ status: Int, _ body: String = "") {
        answers.withLock { $0[request] = Answer(status: status, body: body) }
    }

    var requests: [URLRequest] { received.withLock { $0 } }

    var transport: CluenoriAPI.Transport {
        { [self] request in
            received.withLock { $0.append(request) }
            let key = "\(request.httpMethod ?? "GET") \(request.url?.path(percentEncoded: true) ?? "")"
            let answer = answers.withLock { $0[key] } ?? Answer(status: 404, body: #"{"_tag":"RouteNotFound"}"#)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: answer.status, httpVersion: nil, headerFields: nil)!
            return (Data(answer.body.utf8), response)
        }
    }
}
