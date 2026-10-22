import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// The notes project's components with their deploy targets: an API deployed to dev and prod, an
/// app through TestFlight and the App Store, and a site without any.
let componentsWithTargetsAnswer = #"""
    {"project":{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
    "components":[
      {"key":"notes-api","name":"Notes API","createdAt":"2026-10-01T10:00:00.000Z","repository":"acme/notes",
        "deployTargets":[{"environment":"dev","workflow":"deploy.yml"},{"environment":"prod","workflow":"deploy.yml"}]},
      {"key":"notes-ios","name":"Notes for iOS","createdAt":"2026-10-02T10:00:00.000Z","repository":"acme/notes-ios",
        "deployTargets":[
          {"environment":"internal","workflow":"ios.yml",
            "appStore":{"bundleId":"com.acme.notes.internal","distribution":"testFlight"}},
          {"environment":"production","workflow":"ios.yml",
            "appStore":{"bundleId":"com.acme.notes","distribution":"appStore"}},
          {"environment":"beta","appStore":{"bundleId":"com.acme.notes.beta","distribution":"testFlight"}}]},
      {"key":"notes-web","name":"Notes web","createdAt":"2026-10-03T10:00:00.000Z"}]}
    """#

let promoteLatestPath = "POST /api/projects/notes/components/notes-api/promotions"

/// The promotion of notes-api's newest commit to dev, numbered 1.4.0+58, just started.
let latestPromotion = #"""
    {"id":"019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1","component":"notes-api","release":"1.4.0+58",
      "environment":"dev","repository":"acme/notes","workflow":"deploy.yml","runner":"auto","startedBy":"m1",
      "startedAt":"2026-10-22T10:00:00.000Z","state":"starting"}
    """#

/// The notes project's versions and deployment models, with its components and their targets asked
/// for, as its screens do.
func versionsWithTargets() async throws -> (VersionsModel, DeploymentModels, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes", 200, componentsWithTargetsAnswer)
    deployment.answer("GET /api/projects/notes/versions", 200, versionsAnswer)
    let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
    let models = try #require(pairing.models)
    await models.environments("notes").refresh()
    let versions = models.versions("notes")
    await versions.load()
    return (versions, models, deployment)
}

struct PromoteLatestTests {
    @Test func `offers to promote the newest commit of components with a workflow target only`() async throws {
        let (versions, _, _) = try await versionsWithTargets()

        #expect(versions.lines.map(\.canPromoteLatest) == [true, true, false])

        versions.startPromotingLatest("notes-web")
        #expect(versions.promoteLatest == nil)
        versions.startPromotingLatest("notes-ios")
        let promote = try #require(versions.promoteLatest)
        // The targets that build a commit: not the beta without a workflow.
        #expect(promote.targets.map(\.environment) == ["internal", "production"])
        #expect(promote.environment == "internal")
        #expect(promote.releaseVersion == nil)
        #expect(promote.repository == "acme/notes-ios")
    }

    @Test func `promotes a commit as chosen: to the App Store, on your Mac, released manually`() async throws {
        let (versions, _, deployment) = try await versionsWithTargets()
        deployment.answer(
            "POST /api/projects/notes/components/notes-ios/promotions", 201,
            latestPromotion.replacing(#""component":"notes-api""#, with: #""component":"notes-ios""#))

        versions.startPromotingLatest("notes-ios")
        let promote = try #require(versions.promoteLatest)
        promote.target = promote.targets[1]
        promote.commit = " E91F09C4B2A7D1E8F3C6B5A49D0E2F7A1C3B5D8E "
        promote.runner = .local
        promote.releaseType = .manual
        promote.reason = "Ship the offline drafts"
        #expect(promote.goesToReview)
        await promote.send()

        let body = try #require(deployment.bodies("POST /api/projects/notes/components/notes-ios/promotions").first)
        let sent = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(sent["environment"] as? String == "production")
        #expect(sent["commit"] as? String == "e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e")
        #expect(sent["runner"] as? String == "local")
        #expect(sent["reason"] as? String == "Ship the offline drafts")
        let submission = try #require(sent["submission"] as? [String: Any])
        #expect(submission["releaseType"] as? String == "manual")
        #expect(submission["phased"] as? Bool == true)
    }

    @Test func `promotes the default branch's newest without a commit, and shows it on its release at once`()
        async throws
    {
        let (versions, models, deployment) = try await versionsWithTargets()
        deployment.answer(promoteLatestPath, 201, latestPromotion)
        deployment.answer(
            "GET /api/projects/notes/releases/notes-api/1.4.0%2B58", 404,
            #"{"_tag":"ReleaseNotFound","component":"notes-api","release":"1.4.0+58"}"#)

        versions.startPromotingLatest("notes-api")
        let promote = try #require(versions.promoteLatest)
        await promote.send()

        let body = try #require(deployment.bodies(promoteLatestPath).first)
        #expect(
            try JSONDecoder().decode([String: String].self, from: body) == ["environment": "dev", "runner": "auto"])
        #expect(versions.promoteLatest == nil)
        guard case .started(let promotion) = promote.state else {
            Issue.record("Expected it started, got \(promote.state)")
            return
        }
        let ref = promotion.releaseRef(in: "notes")
        #expect(ref == ReleaseRef(project: "notes", component: "notes-api", environment: "dev", version: "1.4.0+58"))
        // The deployment doesn't know the release until its workflow reports a deploy, yet its
        // screen shows the promotion, and follows it.
        let release = models.release(ref)
        await release.refresh()
        #expect(release.detail.problem == .missing)
        #expect(release.promotions.map(\.id) == ["019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1"])
        #expect(release.hasUnendedPromotions)
    }

    @Test func `says the component needs a version before its commits can be numbered`() async throws {
        let (versions, _, deployment) = try await versionsWithTargets()
        let reason = "notes-api has no version yet, so its commits can't be numbered: set it, such as 1.0.0."
        deployment.answer(promoteLatestPath, 422, #"{"_tag":"PromotionRefused","reason":"\#(reason)","fix":"version"}"#)

        versions.startPromotingLatest("notes-api")
        let promote = try #require(versions.promoteLatest)
        await promote.send()

        #expect(promote.state == .failed(.refused(reason: reason, fix: .version)))
        #expect(versions.promoteLatest === promote)
        #expect(promote.canSend)
    }

    @Test func `says the component is being promoted to the environment already`() async throws {
        let (versions, _, deployment) = try await versionsWithTargets()
        deployment.answer(promoteLatestPath, 409, #"{"_tag":"PromotionInProgress","promotion":\#(latestPromotion)}"#)

        versions.startPromotingLatest("notes-api")
        let promote = try #require(versions.promoteLatest)
        await promote.send()

        guard case .failed(.inProgress(let promotion)) = promote.state else {
            Issue.record("Expected a promotion in progress, got \(promote.state)")
            return
        }
        #expect(promotion.release == "1.4.0+58")
        #expect(versions.promoteLatest === promote)
    }

    @Test func `says when the phone is offline, and keeps nothing to send later`() async throws {
        let (versions, _, deployment) = try await versionsWithTargets()
        versions.startPromotingLatest("notes-api")
        let promote = try #require(versions.promoteLatest)
        deployment.setOffline(true)

        await promote.send()

        #expect(promote.state == .failed(.unreachable))
        deployment.setOffline(false)
        await versions.load()
        #expect(deployment.requests.filter { $0 == promoteLatestPath }.count == 1)
    }

    @Test func `sends no commit that isn't a full SHA`() async throws {
        let (versions, _, deployment) = try await versionsWithTargets()
        versions.startPromotingLatest("notes-api")
        let promote = try #require(versions.promoteLatest)

        promote.commit = "e91f09c"
        #expect(!promote.isCommitValid && !promote.canSend)
        await promote.send()

        #expect(promote.state == .confirming)
        #expect(!deployment.requests.contains(promoteLatestPath))
    }
}
