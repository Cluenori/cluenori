import Foundation

/// What an alert push from the deployment says, from its `cluenori` part: how loud it is, when it
/// happened, the ID its alarm rings under, and the incident it is about.
public nonisolated struct PushAlert: Equatable, Sendable {
    /// How the alert reaches the phone, as the deployment chose.
    public enum Level: String, Sendable {
        /// An alarm that rings through silent mode and Do Not Disturb.
        case alarm
        /// A notification that breaks through a Focus that allows it, with a sound.
        case timeSensitive
        /// A notification without a sound, which stops the incident's alarm.
        case quiet
    }

    /// An incident, by its project's key and its ID.
    public struct Incident: Equatable, Sendable {
        public let project: String
        public let id: String

        public init(project: String, id: String) {
            self.project = project
            self.id = id
        }
    }

    public let level: Level
    /// When what it tells happened.
    public let at: Date
    /// The ID the alarm for it rings under: the incident's, so a later push about the incident
    /// stops it; a test's own.
    public let alert: UUID
    /// Absent for a test and a feed's.
    public let incident: Incident?
    /// The feed whose entries it tells of, by its ID; absent for others.
    public let feed: String?

    /// An alarm this late is told without ringing: it would ring about the past.
    public static let ringsWithin: TimeInterval = 10 * 60

    /// The alert a push's payload holds; nil for a push that isn't one.
    public init?(payload: [AnyHashable: Any]) {
        guard let part = payload["cluenori"] as? [String: Any],
            let level = (part["level"] as? String).flatMap(Level.init(rawValue:)),
            let at = (part["at"] as? String).flatMap({ try? Date($0, strategy: Self.instant) }),
            let alert = (part["alert"] as? String).flatMap(UUID.init(uuidString:))
        else {
            return nil
        }
        self.level = level
        self.at = at
        self.alert = alert
        if let project = part["project"] as? String, let id = part["incident"] as? String {
            incident = Incident(project: project, id: id)
        } else {
            incident = nil
        }
        feed = part["feed"] as? String
    }

    /// Whether its alarm rings at `now`: an alarm less than 10 minutes old.
    public func rings(at now: Date) -> Bool {
        level == .alarm && now.timeIntervalSince(at) < Self.ringsWithin
    }

    /// The screen tapping it opens: the incident's, or the feed's.
    public var route: Route? {
        if let incident {
            return .incident(project: incident.project, id: incident.id)
        }
        return feed.map { .feed(id: $0) }
    }

    private static let instant = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
}
