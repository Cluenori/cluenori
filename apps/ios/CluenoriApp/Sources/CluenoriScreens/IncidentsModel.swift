import CluenoriClient
import Foundation
import Observation

/// A project's incidents, every environment's: those open, and those resolved lately, shown at once
/// from the phone and asked again; and acknowledging one, which says someone is on it, sent once and
/// never kept to send later. One per project, which its tech, its incidents and each incident share.
@Observable
public final class IncidentsModel {
    /// Why acknowledging didn't happen.
    public enum Problem: Equatable, Sendable {
        /// The deployment didn't answer: the phone may be offline.
        case unreachable
        /// The incident is gone: its project, or the incident itself.
        case missing
        /// The deployment answered in a way this app doesn't understand.
        case unreadable
    }

    /// An incident acknowledging didn't reach, and why.
    public struct NotAcknowledged: Equatable, Sendable {
        public let incident: String
        public let problem: Problem
    }

    public let project: String
    public let incidents: Answer<IncidentList>
    /// The incident being acknowledged, while it is.
    public private(set) var acknowledging: String? = nil
    /// The last incident acknowledging didn't reach; nil once one is acknowledged.
    public private(set) var notAcknowledged: NotAcknowledged? = nil

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.api = api
        keyRejected = context.keyRejected
        incidents = Answer(
            context,
            .init(key: "projects/\(project)/incidents") { () async throws(APIError) in
                try await api.incidents(project: project)
            })
    }

    /// Asks for the incidents again.
    public func load() async {
        await incidents.load()
    }

    /// The incident `id`, open or resolved; nil until the incidents arrive, or when they don't list
    /// it.
    public func incident(_ id: String) -> Incident? {
        guard let list = incidents.value else { return nil }
        return (list.open + list.resolved).first { $0.id == id }
    }

    /// Says someone is on incident `id`, for whoever paired the phone: shown acknowledged at once when
    /// the deployment answers, or `notAcknowledged` says why not.
    public func acknowledge(_ id: String) async {
        guard acknowledging == nil else { return }
        acknowledging = id
        defer { acknowledging = nil }
        do {
            let acknowledged = try await api.acknowledge(project: project, incident: id)
            notAcknowledged = nil
            if let list = incidents.value {
                let replaced = { (incident: Incident) in incident.id == id ? acknowledged : incident }
                incidents.show(
                    IncidentList(
                        open: list.open.map(replaced), resolved: list.resolved.map(replaced),
                        checkedAt: list.checkedAt))
            }
        } catch .unauthorized {
            keyRejected()
        } catch .unreachable {
            notAcknowledged = NotAcknowledged(incident: id, problem: .unreachable)
        } catch .incidentNotFound, .projectNotFound {
            notAcknowledged = NotAcknowledged(incident: id, problem: .missing)
        } catch {
            notAcknowledged = NotAcknowledged(incident: id, problem: .unreadable)
        }
    }
}
