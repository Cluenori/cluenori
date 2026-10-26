import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// The notes project with its components' deploy targets: an API deployed to dev, then prod; an app
/// through TestFlight's internal testers to the App Store; and a worker the API's deploys deploy too.
/// It calls prod and production production, and saw prod and staging lately.
let deliveryDetailAnswer = #"""
    {"project":{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
    "components":[
      {"key":"notes-api","name":"Notes API","createdAt":"2026-10-01T10:00:00.000Z","repository":"acme/notes",
        "deployTargets":[{"environment":"dev","workflow":"deploy.yml"},{"environment":"prod","workflow":"deploy.yml"}]},
      {"key":"notes-ios","name":"Notes for iOS","createdAt":"2026-10-02T10:00:00.000Z","repository":"acme/notes-ios",
        "deployTargets":[
          {"environment":"internal","workflow":"ios.yml",
            "appStore":{"bundleId":"com.notesapp.notes","distribution":"testFlight"}},
          {"environment":"production","workflow":"ios.yml",
            "appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}}]},
      {"key":"notes-worker","name":"Notes worker","createdAt":"2026-10-03T10:00:00.000Z","repository":"acme/notes",
        "shipsWith":"notes-api"}],
    "settings":{"productionEnvironments":["prod","production"]},
    "environments":["prod","staging"]}
    """#

/// A release of `component` in `environment`, its commit made at `committedAt` when given.
func summaryJSON(_ component: String, _ environment: String, _ release: String, committedAt: String? = nil) -> String {
    let commit = committedAt.map {
        #","commit":{"sha":"e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e","message":"Cache the feed","committedAt":"\#($0)"}"#
    }
    return #"""
        {"component":"\#(component)","environment":"\#(environment)","release":"\#(release)","verdict":"same",
          "slower":0,"failingMore":0,"newErrors":0\#(commit ?? "")}
        """#
}

/// The promotion of notes-ios 1.2.0+12 to production, in App Store review.
let reviewPromotion = #"""
    {"id":"019a0fb0-5000-7000-8000-000000000001","component":"notes-ios","release":"1.2.0+12",
      "environment":"production","repository":"acme/notes-ios","workflow":"ios.yml","startedBy":"m1",
      "startedAt":"2026-10-22T08:00:00.000Z","state":"inReview",
      "run":{"id":11890001,"url":"https://github.com/acme/notes-ios/actions/runs/11890001"}}
    """#

/// The rejected promotion of notes-ios 1.2.0+12 to production, which left 1.1.0+9 there.
let rejectedPromotion = reviewPromotion.replacing(
    #""state":"inReview""#, with: #""state":"rejected","endedAt":"2026-10-22T11:00:00.000Z""#)

/// Production's delivery once review rejected 1.2.0+12: the promotion that failed, and promoting
/// internal's release again.
let rejectedProduction = #"""
    ,"failedPromotion":\#(rejectedPromotion),"next":{"_tag":"promote","release":"1.2.0+14","from":"internal"}
    """#

/// The notes project's delivery: notes-api's 1.4.0+57 in dev, ready for prod, which has 1.4.0+55;
/// notes-ios's 1.2.0+14 for internal testers, and 1.1.0+9 on the App Store, with `production`'s
/// other fields, a promotion to it under way unless given; and the worker, where it ran. The worker
/// comes last, as the project lists it.
func deliveryJSON(production: String = #","promotion":\#(reviewPromotion)"#) -> String {
    let promotion = production.trimmingCharacters(in: .whitespacesAndNewlines)
    return #"""
        {"components":[
          {"component":"notes-api",
            "version":{"component":"notes-api","version":"1.4.0","lastBuild":57,"setAt":"2026-10-20T10:00:00.000Z"},
            "environments":[
              {"environment":"dev","target":{"environment":"dev","workflow":"deploy.yml"},
                "current":{"summary":\#(summaryJSON("notes-api", "dev", "1.4.0+57")),"since":"2026-10-22T09:00:00.000Z"},
                "next":{"_tag":"buildLatest"}},
              {"environment":"prod","target":{"environment":"prod","workflow":"deploy.yml"},
                "current":{"summary":\#(summaryJSON("notes-api", "prod", "1.4.0+55")),"since":"2026-10-20T12:00:00.000Z"},
                "next":{"_tag":"promote","release":"1.4.0+57","from":"dev"}}]},
          {"component":"notes-ios",
            "environments":[
              {"environment":"internal","target":{"environment":"internal","workflow":"ios.yml",
                  "appStore":{"bundleId":"com.notesapp.notes","distribution":"testFlight"}},
                "current":{"summary":\#(summaryJSON("notes-ios", "internal", "1.2.0+14")),"since":"2026-10-22T10:00:00.000Z"},
                "next":{"_tag":"buildLatest"}},
              {"environment":"production","target":{"environment":"production","workflow":"ios.yml",
                  "appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}},
                "current":{"summary":\#(summaryJSON("notes-ios", "production", "1.1.0+9")),"since":"2026-10-10T10:00:00.000Z"}\#(promotion)}]},
          {"component":"notes-worker","shipsWith":"notes-api",
            "environments":[
              {"environment":"dev",
                "current":{"summary":\#(summaryJSON("notes-worker", "dev", "1.4.0+57")),"since":"2026-10-22T09:00:00.000Z"}}]}]}
        """#
}

/// The promotion of notes-api's newest commit to dev, numbered 1.4.0+58, just started.
let latestPromotion = #"""
    {"id":"019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1","component":"notes-api","release":"1.4.0+58",
      "environment":"dev","repository":"acme/notes","workflow":"deploy.yml","runner":"auto","startedBy":"m1",
      "startedAt":"2026-10-22T10:00:00.000Z","state":"starting"}
    """#

let promoteLatestPath = "POST /api/projects/notes/components/notes-api/promotions"
let promoteNextPath = "POST /api/projects/notes/releases/notes-api/1.4.0%2B57/promotions"

/// The notes project's delivery, with its project asked for, as its screens do.
func notesDelivery(_ delivery: String = deliveryJSON()) async throws -> (
    DeliveryModel, DeploymentModels, FakeDeployment
) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes", 200, deliveryDetailAnswer)
    deployment.answer(deliveryPath, 200, delivery)
    let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
    let models = try #require(pairing.models)
    await models.environments("notes").refresh()
    let model = models.delivery("notes")
    await model.load()
    return (model, models, deployment)
}

struct DeliveryTests {
    @Test
    func `shows each component's environments in the order its releases go, each with what's there and what's next`()
        async throws
    {
        let (delivery, models, _) = try await notesDelivery()

        // A component that ships with another follows it.
        #expect(delivery.components.map(\.component) == ["notes-api", "notes-worker", "notes-ios"])
        let api = try #require(delivery.component("notes-api"))
        #expect(api.name == "Notes API")
        #expect(api.stages.map(\.environment) == ["dev", "prod"])
        #expect(api.stages.map(\.isProduction) == [false, true])
        #expect(api.stages.map { $0.current?.summary.release } == ["1.4.0+57", "1.4.0+55"])
        #expect(api.nextRelease == "1.4.0+58")
        #expect(api.parts.map(\.component) == ["notes-worker"])
        #expect(api.parts.map(\.name) == ["Notes worker"])
        #expect(api.hasDeployTargets)

        let worker = try #require(delivery.component("notes-worker"))
        #expect(worker.shipsWith == "notes-api")
        #expect(worker.stages.map(\.target) == [nil])
        #expect(worker.stages.map(\.next) == [nil])
        #expect(!worker.hasDeployTargets)

        // A promotion under way leaves no next step there.
        let ios = try #require(delivery.component("notes-ios"))
        #expect(ios.promotions.map(\.release) == ["1.2.0+12"])
        #expect(ios.stages.map(\.next) == [.buildLatest(to: "internal", release: nil), nil])
        #expect(delivery.hasUnendedPromotions)
        // The same model is the project's screens' and its releases'.
        #expect(models.delivery("notes") === delivery)
        #expect(models.release(feedRelease).delivery === delivery)
    }

    @Test func `names each next step in full: what goes, from where, and where to`() async throws {
        let (delivery, _, _) = try await notesDelivery()
        let stages = try #require(delivery.component("notes-api")).stages

        // `Promote 1.4.0+57 to prod`, and `Build latest commit`, which becomes 1.4.0+58.
        #expect(stages[1].next == .promote(release: "1.4.0+57", from: "dev", to: "prod"))
        #expect(stages[1].next?.environment == "prod")
        #expect(stages[0].next == .buildLatest(to: "dev", release: "1.4.0+58"))
        // Without a version, a build can't say what it becomes.
        #expect(delivery.component("notes-ios")?.stages.first?.next == .buildLatest(to: "internal", release: nil))
    }

    @Test func `shows a next step of a kind this app doesn't know as unknown, and opens nothing for it`()
        async throws
    {
        let unknown = deliveryJSON().replacing(
            #"{"_tag":"buildLatest"}"#, with: #"{"_tag":"buildBranch","branch":"x"}"#)
        let (delivery, _, _) = try await notesDelivery(unknown)

        let step = try #require(delivery.component("notes-api")?.stages.first?.next)
        #expect(step == .unknown(to: "dev"))
        delivery.start(step, of: "notes-api")
        #expect(delivery.promote == nil)
    }

    @Test func `promotes the release before to the next environment, saying what it replaces there`()
        async throws
    {
        let (delivery, models, deployment) = try await notesDelivery()
        deployment.answer(
            promoteNextPath, 201,
            latestPromotion.replacing("1.4.0+58", with: "1.4.0+57").replacing(
                #""environment":"dev""#, with: #""environment":"prod""#))

        delivery.start(.promote(release: "1.4.0+57", from: "dev", to: "prod"), of: "notes-api")
        let promote = try #require(delivery.promote)
        #expect(
            promote.subject
                == .release(
                    ReleaseRef(project: "notes", component: "notes-api", environment: "dev", version: "1.4.0+57")))
        #expect(promote.targets == [DeployTarget(environment: "prod", workflow: "deploy.yml")])
        #expect(promote.repository == "acme/notes")
        #expect(promote.replacing?.release == "1.4.0+55")
        #expect(promote.replacing?.isRollback == false)
        await promote.send()

        #expect(delivery.promote == nil)
        let body = try #require(deployment.bodies(promoteNextPath).first)
        #expect(
            try JSONDecoder().decode([String: String].self, from: body) == ["environment": "prod", "runner": "auto"])
        // It shows at once, in place of the next step, and on its release's screen.
        let prod = try #require(delivery.component("notes-api")?.stages.last)
        #expect(prod.promotion?.release == "1.4.0+57")
        #expect(prod.next == nil)
        #expect(delivery.lastStarted?.id == prod.promotion?.id)
        let ref = ReleaseRef(project: "notes", component: "notes-api", environment: "prod", version: "1.4.0+57")
        #expect(models.release(ref).promotions.map(\.environment) == ["prod"])
    }

    @Test func `builds the newest commit for the first environment alone, and shows it on its release at once`()
        async throws
    {
        let (delivery, models, deployment) = try await notesDelivery()
        deployment.answer(promoteLatestPath, 201, latestPromotion)
        deployment.answer(
            "GET /api/projects/notes/releases/notes-api/1.4.0%2B58", 404,
            #"{"_tag":"ReleaseNotFound","component":"notes-api","release":"1.4.0+58"}"#)

        delivery.start(.buildLatest(to: "dev", release: "1.4.0+58"), of: "notes-api")
        let promote = try #require(delivery.promote)
        #expect(promote.subject == .latestCommit(project: "notes", component: "notes-api"))
        #expect(promote.targets.map(\.environment) == ["dev"])
        #expect(promote.replacing?.release == "1.4.0+57")
        await promote.send()

        let body = try #require(deployment.bodies(promoteLatestPath).first)
        #expect(
            try JSONDecoder().decode([String: String].self, from: body) == ["environment": "dev", "runner": "auto"])
        #expect(delivery.component("notes-api")?.stages.first?.promotion?.release == "1.4.0+58")
        // The deployment doesn't know the release until its workflow reports a deploy, yet its
        // screen shows the promotion, and follows it.
        let release = models.release(
            ReleaseRef(project: "notes", component: "notes-api", environment: "dev", version: "1.4.0+58"))
        await release.refresh()
        #expect(release.detail.problem == .missing)
        #expect(release.promotions.map(\.id) == ["019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1"])
        #expect(release.hasUnendedPromotions)
    }

    @Test func `opens no sheet for a step the delivery doesn't offer now`() async throws {
        let (delivery, _, _) = try await notesDelivery()

        // Production has a promotion under way; dev has no release to promote to it.
        delivery.start(.promote(release: "1.2.0+14", from: "internal", to: "production"), of: "notes-ios")
        delivery.start(.promote(release: "1.4.0+55", from: "dev", to: "prod"), of: "notes-api")
        delivery.start(.buildLatest(to: "dev", release: nil), of: "notes-worker")
        #expect(delivery.promote == nil)
    }

    @Test func `says the component needs a version before its commits can be numbered, keeping the sheet open`()
        async throws
    {
        let (delivery, _, deployment) = try await notesDelivery()
        let reason = "notes-api has no version yet, so its commits can't be numbered: set it, such as 1.0.0."
        deployment.answer(promoteLatestPath, 422, #"{"_tag":"PromotionRefused","reason":"\#(reason)","fix":"version"}"#)

        delivery.start(.buildLatest(to: "dev", release: "1.4.0+58"), of: "notes-api")
        let promote = try #require(delivery.promote)
        await promote.send()

        #expect(promote.state == .failed(.refused(reason: reason, fix: .version)))
        #expect(delivery.promote === promote)
        #expect(promote.canSend)
        delivery.cancelPromoting()
        #expect(delivery.promote == nil)
    }

    @Test
    func `says the environment is being promoted to already, offline sends nothing later, and a short SHA isn't sent`()
        async throws
    {
        let (delivery, _, deployment) = try await notesDelivery()
        deployment.answer(promoteLatestPath, 409, #"{"_tag":"PromotionInProgress","promotion":\#(latestPromotion)}"#)
        delivery.start(.buildLatest(to: "dev", release: "1.4.0+58"), of: "notes-api")
        let promote = try #require(delivery.promote)

        await promote.send()
        guard case .failed(.inProgress(let promotion)) = promote.state else {
            Issue.record("Expected a promotion in progress, got \(promote.state)")
            return
        }
        #expect(promotion.release == "1.4.0+58")

        deployment.setOffline(true)
        await promote.send()
        #expect(promote.state == .failed(.unreachable))
        deployment.setOffline(false)

        promote.commit = "e91f09c"
        #expect(!promote.isCommitValid && !promote.canSend)
        await promote.send()
        #expect(deployment.requests.filter { $0 == promoteLatestPath }.count == 2)
    }

    @Test(.timeLimit(.minutes(1)))
    func `follows promotions until they end, from the delivery alone`() async throws {
        let (delivery, _, deployment) = try await notesDelivery()
        deployment.answer(deliveryPath, 200, deliveryJSON(production: rejectedProduction))

        await delivery.followPromotions(every: .milliseconds(1))

        let production = try #require(delivery.component("notes-ios")?.stages.last)
        #expect(production.promotion == nil)
        #expect(production.failed?.state == .rejected)
        #expect(!delivery.hasUnendedPromotions)
        // How it ended is the delivery's to say: no release is asked.
        #expect(!deployment.requests.contains { $0.contains("/releases/") })
    }

    @Test func `says the release that reached production last, for Releases' line`() async throws {
        let (delivery, _, _) = try await notesDelivery()

        let overview = try #require(delivery.overview)
        // The API's 1.4.0+55 reached production after the app's 1.1.0+9 did.
        #expect(overview.latestInProduction?.release == "1.4.0+55")
        #expect(overview.latestInProduction?.component == "Notes API")
    }

    @Test func `shows the promotion that failed, after a relaunch too, and offers the next step again`()
        async throws
    {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/projects/notes", 200, deliveryDetailAnswer)
        online.answer(deliveryPath, 200, deliveryJSON(production: rejectedProduction))
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.environments("notes").refresh()
        await first.models?.delivery("notes").load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let delivery = try #require(next.models).delivery("notes")
        let ios = try #require(delivery.component("notes-ios"))
        let production = try #require(ios.stages.last)
        #expect(production.failed?.id == "019a0fb0-5000-7000-8000-000000000001")
        #expect(production.failed?.release == "1.2.0+12")
        #expect(production.failed?.runPage == URL(string: "https://github.com/acme/notes-ios/actions/runs/11890001"))
        #expect(production.current?.summary.release == "1.1.0+9")
        #expect(production.next == .promote(release: "1.2.0+14", from: "internal", to: "production"))
        #expect(ios.promotions.isEmpty)
    }

    @Test func `hides the promotion that failed once another starts from the phone`() async throws {
        let (delivery, _, deployment) = try await notesDelivery(deliveryJSON(production: rejectedProduction))
        deployment.answer(
            "POST /api/projects/notes/releases/notes-ios/1.2.0%2B14/promotions", 201,
            reviewPromotion.replacing("1.2.0+12", with: "1.2.0+14").replacing(
                #""state":"inReview""#, with: #""state":"starting""#))

        delivery.start(.promote(release: "1.2.0+14", from: "internal", to: "production"), of: "notes-ios")
        await delivery.promote?.send()

        let production = try #require(delivery.component("notes-ios")?.stages.last)
        #expect(production.promotion?.release == "1.2.0+14")
        #expect(production.failed == nil)
        #expect(production.next == nil)
    }

    @Test func `shows the delivery it kept, offline`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer(deliveryPath, 200, deliveryJSON())
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.delivery("notes").load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let delivery = try #require(next.models).delivery("notes")
        await delivery.load()
        #expect(delivery.answer.problem == .unreachable)
        #expect(delivery.component("notes-api")?.stages.count == 2)
        // Without the project, a component's name is its key.
        #expect(delivery.component("notes-api")?.name == "notes-api")
    }
}

struct ReleasePlacesTests {
    @Test func `says where a release is, where it hasn't reached, and its one next step`() async throws {
        let (delivery, _, _) = try await notesDelivery()

        let newest = try #require(delivery.places(of: "1.4.0+57", component: "notes-api", summary: nil))
        #expect(newest.here.map(\.environment) == ["dev"])
        #expect(newest.notYet == ["prod"])
        #expect(newest.next == .promote(release: "1.4.0+57", from: "dev", to: "prod"))
        #expect(newest.otherDeploys.isEmpty)

        // The release in prod could go back to dev: older than the one there, a roll back.
        let older = try #require(delivery.places(of: "1.4.0+55", component: "notes-api", summary: nil))
        #expect(older.here.map(\.environment) == ["prod"])
        #expect(older.here.map(\.isProduction) == [true])
        #expect(older.notYet.isEmpty && older.next == nil)
        #expect(older.otherDeploys.map(\.environment) == ["dev"])
        #expect(older.otherDeploys.map(\.isRollback) == [true])
        #expect(older.otherDeploys.first?.replacing?.summary.release == "1.4.0+57")

        // One being promoted: no other way there meanwhile.
        let reviewed = try #require(delivery.places(of: "1.2.0+12", component: "notes-ios", summary: nil))
        #expect(reviewed.here.isEmpty)
        #expect(reviewed.promoting.map(\.environment) == ["production"])
        #expect(reviewed.otherDeploys.map(\.environment) == ["internal"])
    }

    @Test func `tells an older release by its commit when its name isn't a number Cluenori gave`() async throws {
        // Prod's release was committed a day after the old one; dev's commit isn't known.
        let (delivery, _, _) = try await notesDelivery(
            deliveryJSON().replacing(
                summaryJSON("notes-api", "prod", "1.4.0+55"),
                with: summaryJSON("notes-api", "prod", "1.4.0+55", committedAt: "2026-10-21T08:00:00.000Z")))
        let summary = try JSONDecoder.api.decode(
            ReleaseSummary.self,
            from: Data(
                summaryJSON("notes-api", "prod", "2026.10.20-a1b2c3d", committedAt: "2026-10-20T08:00:00.000Z").utf8))

        let old = try #require(delivery.places(of: "2026.10.20-a1b2c3d", component: "notes-api", summary: summary))
        #expect(old.here.isEmpty && old.next == nil)
        #expect(old.otherDeploys.map(\.environment) == ["dev", "prod"])
        // A roll back only where it can be told: not dev, whose commit isn't known.
        #expect(old.otherDeploys.map(\.isRollback) == [false, true])
        #expect(old.notYet == ["dev"])
    }

    @Test func `promotes a release only to its next step's environment or another, replacing what's there`()
        async throws
    {
        let (_, models, deployment) = try await notesDelivery()
        deployment.answer(
            "GET /api/projects/notes/releases/notes-api/1.4.0%2B55", 200,
            #"""
            {"summary":\#(summaryJSON("notes-api", "prod", "1.4.0+55")),
              "slower":[],"failingMore":[],"faster":[],"failingLess":[],"newOperations":[],"errors":[],
              "incidents":[],"problems":[],"promotions":[],"deployTargets":[],"notes":[],"repository":"acme/notes"}
            """#)
        let release = models.release(
            ReleaseRef(project: "notes", component: "notes-api", environment: "prod", version: "1.4.0+55"))
        await release.refresh()

        // It is in prod already.
        release.startPromoting(to: "prod")
        #expect(release.promote == nil)
        release.startPromoting(to: "dev")
        let promote = try #require(release.promote)
        #expect(promote.environment == "dev")
        #expect(promote.replacing?.release == "1.4.0+57")
        #expect(promote.replacing?.isRollback == true)
    }
}

struct EnvironmentOptionsTests {
    @Test func `offers the deploy targets' environments in their order, then those seen, production marked`()
        async throws
    {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes", 200, deliveryDetailAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let choice = try #require(pairing.models).environments("notes")
        await choice.loadOnce()

        // Dev was never seen, yet its releases go there.
        #expect(choice.environments == ["dev", "prod", "internal", "production", "staging"])
        #expect(choice.production == ["prod", "production"])
        #expect(choice.isProduction("production") && !choice.isProduction("dev"))
        // The first production environment, not the first in order.
        #expect(choice.chosen == "prod")

        pairing.navigation.show("dev", of: choice)
        #expect(choice.chosen == "dev")
    }
}

extension JSONDecoder {
    /// A decoder of the API's answers: dates as ISO 8601, with fractional seconds.
    static var api: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            return try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)
        }
        return decoder
    }
}
