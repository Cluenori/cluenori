import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

// 2026-10-26T10:00:00Z, the start of the made-up day.
private let tenOClock = Date(timeIntervalSince1970: 1_793_008_800)

private func span(
    _ id: String, parent: String? = nil, depth: Int, name: String, kind: SpanKind, startMs: Double, durationMs: Double,
    failed: Bool = false, attributes: [String: JSONValue] = [:]
) -> TraceSpan {
    TraceSpan(
        span: id, parent: parent, depth: depth, name: name, kind: kind, component: "notes-api",
        start: tenOClock.addingTimeInterval(startMs / 1_000), durationMs: durationMs, failed: failed,
        attributes: attributes, events: [])
}

// The export that failed: 4.2 s, 500, its insert at the end of it.
private let exportTrace = TraceView(
    trace: "f2b7d04e9a1c3865e7d0b4a9c2f15e63",
    searched: Period(from: tenOClock, to: tenOClock.addingTimeInterval(60)),
    spans: [
        span(
            "a1", depth: 0, name: "POST /api/export", kind: .server, startMs: 0, durationMs: 4_200, failed: true,
            attributes: ["http.response.status_code": .number(500)]),
        span("b2", parent: "a1", depth: 1, name: "INSERT exports", kind: .client, startMs: 3_150, durationMs: 1_050),
    ],
    logs: [],
    files: SearchedFiles(read: 2, unread: 0))

struct PerformanceTests {
    @Test func `opens the step of a chart that holds the moment tapped, and none outside what it covers`() throws {
        let series = LoadSeries(
            covered: Period(from: tenOClock, to: tenOClock.addingTimeInterval(3_600)), step: .`5m`,
            points: [
                LoadPoint(
                    start: tenOClock.addingTimeInterval(300), count: 40, errors: 1, p50Ms: 60, p80Ms: 120, p95Ms: 240,
                    p99Ms: 900)
            ])

        let moment = try #require(Moment(at: tenOClock.addingTimeInterval(7 * 60 + 13), in: series))

        #expect(moment.from == tenOClock.addingTimeInterval(300))
        #expect(moment.to == tenOClock.addingTimeInterval(600))
        #expect(moment.point(in: series)?.count == 40)
        // A step with nothing reported has no point, which isn't none ran.
        #expect(Moment(at: tenOClock.addingTimeInterval(20 * 60), in: series)?.point(in: series) == nil)
        #expect(Moment(at: tenOClock.addingTimeInterval(-1), in: series) == nil)
        #expect(Moment(at: tenOClock.addingTimeInterval(3_600), in: series) == nil)
        // A period's first step is partly before its counts: its requests are asked only from
        // where they start, and its point is still the step's.
        let partial = LoadSeries(
            covered: Period(from: tenOClock.addingTimeInterval(180), to: tenOClock.addingTimeInterval(3_600)),
            step: .`5m`,
            points: [
                LoadPoint(start: tenOClock, count: 1, errors: 0, p50Ms: 60, p80Ms: 60, p95Ms: 60, p99Ms: 60)
            ])
        let first = try #require(Moment(at: tenOClock.addingTimeInterval(240), in: partial))
        #expect(first.start == tenOClock)
        #expect(first.from == tenOClock.addingTimeInterval(180))
        #expect(first.to == tenOClock.addingTimeInterval(300))
        #expect(first.point(in: partial)?.count == 1)
        #expect(Moment(at: tenOClock.addingTimeInterval(60), in: partial) == nil)
    }

    @Test func `places each step of a trace on one time line, where it started and as long as it ran`() {
        let rows = TraceModel.waterfall(exportTrace)

        #expect(rows.map(\.span.span) == ["a1", "b2"])
        #expect(rows[0].offset == 0)
        #expect(abs(rows[0].width - 1) < 0.000_001)
        #expect(abs(rows[1].offset - 0.75) < 0.000_001)
        #expect(abs(rows[1].width - 0.25) < 0.000_001)
    }

    @Test func `briefs an agent on a request: what it was, how it ended, and how to read it`() throws {
        let brief = try #require(TraceModel.agentBrief(project: "notes", view: exportTrace))

        #expect(brief.contains("Trace f2b7d04e9a1c3865e7d0b4a9c2f15e63: POST /api/export in notes-api"))
        #expect(brief.contains("took 4200 ms, answered 500, failed"))
        #expect(
            brief.contains(
                "GET /api/projects/notes/traces/f2b7d04e9a1c3865e7d0b4a9c2f15e63?around=2026-10-26T10:00:00Z"))
        #expect(brief.contains("./cluenori operation notes 'POST /api/export' --component notes-api"))
        // A name and a status are what the app sent: a shell reads the name as one argument, and a
        // status that isn't one is left out rather than crashing the screen.
        let hostile = TraceView(
            trace: "0", searched: exportTrace.searched,
            spans: [
                span(
                    "a1", depth: 0, name: "GET /$(touch x) it's", kind: .server, startMs: 0, durationMs: 5,
                    attributes: ["http.response.status_code": .number(1e100)])
            ], logs: [], files: SearchedFiles(read: 1, unread: 0))
        let hostileBrief = try #require(TraceModel.agentBrief(project: "notes", view: hostile))
        #expect(hostileBrief.contains(#"./cluenori operation notes 'GET /$(touch x) it'\''s' --component"#))
        #expect(!hostileBrief.contains("answered"))
        let empty = TraceView(
            trace: "0", searched: exportTrace.searched, spans: [], logs: [], files: SearchedFiles(read: 0, unread: 0))
        #expect(TraceModel.agentBrief(project: "notes", view: empty) == nil)
    }

    @Test func `opens one operation by its link, its name's slashes kept, and none without its component`() throws {
        let url = try #require(
            URL(
                string:
                    "cluenori://projects/notes/operations/GET%20/api/notes/%7Bid%7D?component=notes-api&environment=prod"
            ))
        let nameless = try #require(URL(string: "cluenori://projects/notes/operations/GET%20/api/feed"))

        let route = try #require(Route(url))

        #expect(
            route
                == .operation(
                    OperationRef(
                        project: "notes", component: "notes-api", environment: "prod", name: "GET /api/notes/{id}")))
        #expect(Route(nameless) == nil)
        let trailing = try #require(
            URL(string: "cluenori://projects/notes/operations/POST%20/api/profile/?component=notes-api"))
        #expect(
            Route(trailing)
                == .operation(
                    OperationRef(project: "notes", component: "notes-api", environment: nil, name: "POST /api/profile/")
                ))
    }

    @Test func `opens a request by its link, under its project's operations`() throws {
        let url = try #require(
            URL(string: "cluenori://projects/notes/traces/f2b7d04e9a1c3865e7d0b4a9c2f15e63?around=2026-10-26T10:00:00Z")
        )

        let route = try #require(Route(url))

        let trace = TraceRef(project: "notes", id: "f2b7d04e9a1c3865e7d0b4a9c2f15e63", around: tenOClock)
        #expect(route == .trace(trace))
        #expect(route.chain == [.project("notes"), .tech(project: "notes"), .operations(of: .project("notes")), route])
    }
}
