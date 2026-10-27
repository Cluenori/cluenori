import Foundation

extension Route {
    /// The screen a route opens, by its kind alone (`operation`, never the operation), as the app's
    /// own telemetry names it.
    public var screenName: String {
        switch self {
        case .feeds: "feeds"
        case .feed: "feed"
        case .project: "project"
        case .tech: "tech"
        case .incidents: "incidents"
        case .incident: "incident"
        case .uptime: "uptime"
        case .monitor: "monitor"
        case .delivery: "delivery"
        case .operations: "operations"
        case .operation: "operation"
        case .trace: "trace"
        case .errors: "errors"
        case .error: "error"
        case .logs: "logs"
        case .logMessage: "logMessage"
        case .logLine: "logLine"
        case .releases, .componentReleases: "releases"
        case .component: "component"
        case .release: "release"
        case .notes: "notes"
        case .notesStyle: "notesStyle"
        case .analytics: "analytics"
        case .features: "features"
        case .appHealth: "appHealth"
        case .feature: "feature"
        case .person, .personByID: "person"
        case .versionPolicy: "versionPolicy"
        case .sdkKeys: "sdkKeys"
        case .ingestKeys: "ingestKeys"
        }
    }

    /// The feature the screen is, named as the dashboard and the CLI name it, so a feature's story
    /// reads across every client (docs/self-telemetry.md, "Features").
    public var feature: String {
        switch self {
        case .feeds, .feed: "feeds"
        case .project: "projects.overview"
        case .tech: "tech"
        case .incidents, .incident: "incidents"
        case .uptime, .monitor: "uptime"
        case .delivery, .component: "releases.delivery"
        case .operations, .operation: "tech.performance"
        case .trace: "tech.traces"
        case .errors, .error: "tech.errors"
        case .logs, .logMessage, .logLine: "tech.logs"
        case .releases, .componentReleases, .release: "releases"
        case .notes, .notesStyle: "releases.notes"
        case .analytics: "analytics"
        case .features, .feature: "analytics.features"
        case .appHealth: "analytics.releases"
        case .person, .personByID: "analytics.people"
        case .versionPolicy: "analytics.version-policy"
        case .sdkKeys: "analytics.sdk-keys"
        case .ingestKeys: "settings.ingest-keys"
        }
    }
}
