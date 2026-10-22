import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// Two deploy targets with workflows alone: production, then staging.
let workflowTargets = #"""
    [{"environment":"production","workflow":"promote-to-prod.yml"},
      {"environment":"staging","workflow":"promote-to-staging.yml"}]
    """#

/// `feedRelease`'s detail, with `promotions`, its component's deploy `targets`, its `notes`, and
/// its repository, when it names one.
func promotedReleaseAnswer(
    _ promotions: String, targets: String = workflowTargets, notes: String = "", repository: String? = "acme/notes"
) -> String {
    let repository = repository.map { #","repository":"\#($0)""# } ?? ""
    return #"""
        {"summary":{"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
          "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
          "previous":"2026.10.20-a1b2c3d","verdict":"same","slower":0,"failingMore":0,"newErrors":0},
        "slower":[],"failingMore":[],"faster":[],"failingLess":[],"newOperations":[],"newErrors":[],"incidents":[],
        "problems":[],
        "promotions":[\#(promotions)],
        "deployTargets":\#(targets),"notes":[\#(notes)]\#(repository)}
        """#
}

/// A promotion to production that is running, started by the member `m1` with a reason.
let runningPromotion = #"""
    {"id":"019a0f60-1c00-7a10-8b2c-1d2e3f4a5b6c","component":"notes-api","release":"2026.10.21-e91f09c",
      "environment":"production","repository":"acme/notes","workflow":"promote-to-prod.yml","startedBy":"m1",
      "reason":"Fixes the feed's cache","startedAt":"2026-10-21T14:00:00.000Z","state":"running",
      "run":{"id":11873001,"url":"https://github.com/acme/notes/actions/runs/11873001"}}
    """#

/// The same promotion, once its run succeeded.
let succeededPromotion = runningPromotion.replacing(
    #""state":"running""#, with: #""state":"succeeded","endedAt":"2026-10-21T14:06:00.000Z""#)

/// Two ended promotions to staging: one the member `m2` started, which succeeded; and one an agent
/// started, whose run was never found.
let endedPromotions = #"""
    {"id":"019a0f20-0a00-7b20-9c3d-2e3f4a5b6c7d","component":"notes-api","release":"2026.10.21-e91f09c",
      "environment":"staging","repository":"acme/notes","workflow":"promote-to-staging.yml","startedBy":"m2",
      "startedAt":"2026-10-21T10:00:00.000Z","state":"succeeded",
      "run":{"id":11870002,"url":"https://github.com/acme/notes/actions/runs/11870002"},
      "endedAt":"2026-10-21T10:04:00.000Z"},
    {"id":"019a0f10-0900-7c30-ad4e-3f4a5b6c7d8e","component":"notes-api","release":"2026.10.21-e91f09c",
      "environment":"staging","repository":"acme/notes","workflow":"promote-to-staging.yml",
      "startedAt":"2026-10-21T09:00:00.000Z","state":"lost","endedAt":"2026-10-21T09:10:00.000Z"}
    """#

/// The promotion the deployment answers a promotion to production with: just started, its run not
/// known yet.
let startedPromotion = #"""
    {"id":"019a0f70-2d00-7d40-be5f-4a5b6c7d8e9f","component":"notes-api","release":"2026.10.21-e91f09c",
      "environment":"production","repository":"acme/notes","workflow":"promote-to-prod.yml","startedBy":"m1",
      "reason":"Fixes the feed's cache","startedAt":"2026-10-21T15:00:00.000Z","state":"starting"}
    """#

let memberAnswer = #"""
    {"id":"m1","role":"owner","addedAt":"2026-10-01T10:00:00.000Z","passkeys":1}
    """#

let feedReleasePath = "/api/projects/notes/releases/notes-api/2026.10.21-e91f09c"
let promotePath = "POST /api/projects/notes/releases/notes-api/2026.10.21-e91f09c/promotions"

/// Holds the requests it is asked to until the test lets them go.
actor Gate {
    private var isOpen = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    func open() {
        isOpen = true
        for continuation in waiting {
            continuation.resume()
        }
        waiting = []
    }
}

/// The release `feedRelease`, its detail as `promotions` and `repository` make it, from a
/// deployment that knows the phone acts for the member `m1`.
func promotedRelease(
    _ promotions: String, targets: String = workflowTargets, notes: String = "", repository: String? = "acme/notes"
) async throws -> (ReleaseModel, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer(
        "GET \(feedReleasePath)", 200,
        promotedReleaseAnswer(promotions, targets: targets, notes: notes, repository: repository))
    deployment.answer("GET /api/me", 200, memberAnswer)
    let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
    let release = try #require(pairing.models).release(feedRelease)
    await release.refresh()
    return (release, deployment)
}

struct PromotionsTests {
    @Test func `shows a release's promotions, the latest first, and the environments it can be promoted to`()
        async throws
    {
        let (release, _) = try await promotedRelease("\(runningPromotion),\(endedPromotions)")

        let promotions = release.promotions
        #expect(promotions.map(\.environment) == ["production", "staging", "staging"])
        #expect(promotions.map(\.state) == [.running, .succeeded, .lost])
        #expect(promotions.map(\.hasEnded) == [false, true, true])
        #expect(promotions[0].reason == "Fixes the feed's cache")
        #expect(promotions[0].runPage == URL(string: "https://github.com/acme/notes/actions/runs/11873001"))
        #expect(promotions[0].endedAt == nil)
        // A run never found has no page to open.
        #expect(promotions[2].runPage == nil)
        #expect(release.hasUnendedPromotions)
        #expect(release.deployTargets.map(\.environment) == ["production", "staging"])
        #expect(release.deployTargets[0].workflow == "promote-to-prod.yml")
        #expect(release.detail.value?.repository == "acme/notes")
    }

    @Test func `says which promotions the member the phone acts for started, and not an agent's or another's`()
        async throws
    {
        let (release, deployment) = try await promotedRelease("\(runningPromotion),\(endedPromotions)")

        #expect(release.promotions.map(release.isYours) == [true, false, false])

        // Known once, the member isn't asked again.
        await release.refresh()
        #expect(deployment.requests.filter { $0 == "GET /api/me" }.count == 1)
    }

    @Test func `doesn't ask who the phone acts for when no promotion says who started it`() async throws {
        let (release, deployment) = try await promotedRelease("")

        #expect(release.promotions.isEmpty)
        #expect(!deployment.requests.contains("GET /api/me"))
    }

    @Test func `promotes a release, showing its promotion at once and closing its sheet`() async throws {
        let (release, deployment) = try await promotedRelease("")
        deployment.answer(promotePath, 201, startedPromotion)

        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)
        #expect(promote.environment == "production")
        #expect(promote.target.workflow == "promote-to-prod.yml")
        // The component's repository, before any promotion names it.
        #expect(promote.repository == "acme/notes")
        promote.reason = "  Fixes the feed's cache\n"
        await promote.send()

        #expect(release.promote == nil)
        let started = try #require(release.promotions.first)
        #expect(promote.state == .started(started))
        #expect(started.id == "019a0f70-2d00-7d40-be5f-4a5b6c7d8e9f")
        #expect(started.state == .starting)
        #expect(release.hasUnendedPromotions)
        let body = try #require(deployment.bodies(promotePath).first)
        let sent = try JSONDecoder().decode([String: String].self, from: body)
        // A workflow runs where Auto says, unless chosen.
        #expect(sent == ["environment": "production", "reason": "Fixes the feed's cache", "runner": "auto"])
    }

    @Test func `leaves an empty reason out, and the repository when the release doesn't name one`() async throws {
        let (release, deployment) = try await promotedRelease(endedPromotions, repository: nil)
        deployment.answer(promotePath, 201, startedPromotion)

        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)
        // Earlier promotions name a repository, but the component's may have changed since.
        #expect(promote.repository == nil)
        promote.reason = " \n "
        await promote.send()

        let body = try #require(deployment.bodies(promotePath).first)
        #expect(
            try JSONDecoder().decode([String: String].self, from: body) == [
                "environment": "production", "runner": "auto",
            ])
        // Once the detail lists it, it is shown once.
        deployment.answer(
            "GET \(feedReleasePath)", 200,
            promotedReleaseAnswer("\(startedPromotion),\(endedPromotions)", repository: nil))
        await release.refresh()
        #expect(
            release.promotions.map(\.id) == [
                "019a0f70-2d00-7d40-be5f-4a5b6c7d8e9f", "019a0f20-0a00-7b20-9c3d-2e3f4a5b6c7d",
                "019a0f10-0900-7c30-ad4e-3f4a5b6c7d8e",
            ])
    }

    @Test(.timeLimit(.minutes(1)))
    func `shows it's sending while it sends, sends once, and can't be cancelled then`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET \(feedReleasePath)", 200, promotedReleaseAnswer(""))
        deployment.answer(promotePath, 201, startedPromotion)
        let gate = Gate()
        let pairing = PairingModel(
            store: MemoryStore(paired),
            details: details,
            transport: { request in
                if request.httpMethod == "POST" {
                    await gate.wait()
                }
                return try await deployment.transport(request)
            }
        )
        let release = try #require(pairing.models).release(feedRelease)
        await release.refresh()
        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)

        let sending = Task { await promote.send() }
        while promote.state != .sending {
            await Task.yield()
        }
        #expect(!promote.canSend)
        await promote.send()
        release.cancelPromoting()
        #expect(release.promote === promote)

        await gate.open()
        await sending.value
        #expect(deployment.requests.filter { $0 == promotePath }.count == 1)
        #expect(release.promote == nil)
        #expect(release.promotions.count == 1)
    }

    @Test func `says why a promotion is refused, keeping the sheet open to try again`() async throws {
        let (release, deployment) = try await promotedRelease("")
        let reason = "Cluenori isn't installed on acme/notes. Install it on GitHub, then try again."
        deployment.answer(promotePath, 422, #"{"_tag":"PromotionRefused","reason":"\#(reason)","fix":"github"}"#)

        release.startPromoting(release.deployTargets[1])
        let promote = try #require(release.promote)
        await promote.send()

        #expect(promote.state == .failed(.refused(reason: reason, fix: .github)))
        #expect(release.promote === promote)
        #expect(promote.canSend)
        #expect(release.promotions.isEmpty)

        release.cancelPromoting()
        #expect(release.promote == nil)
    }

    @Test func `says the component is being promoted to the environment already, with its run`() async throws {
        let (release, deployment) = try await promotedRelease("")
        deployment.answer(promotePath, 409, #"{"_tag":"PromotionInProgress","promotion":\#(runningPromotion)}"#)

        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)
        await promote.send()

        guard case .failed(.inProgress(let promotion)) = promote.state else {
            Issue.record("Expected a promotion in progress, got \(promote.state)")
            return
        }
        #expect(promotion.release == "2026.10.21-e91f09c")
        #expect(promotion.environment == "production")
        #expect(promotion.runPage == URL(string: "https://github.com/acme/notes/actions/runs/11873001"))
        #expect(release.promote === promote)
    }

    @Test func `says GitHub didn't answer, or the phone is offline, and keeps nothing to send later`() async throws {
        let (release, deployment) = try await promotedRelease("")
        deployment.answer(
            promotePath, 503, #"{"_tag":"PromotionUnavailable","reason":"GitHub answered 502 three times."}"#)
        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)

        await promote.send()
        #expect(promote.state == .failed(.unavailable))

        deployment.setOffline(true)
        await promote.send()
        #expect(promote.state == .failed(.unreachable))

        deployment.setOffline(false)
        await release.refresh()
        #expect(deployment.requests.filter { $0 == promotePath }.count == 2)
        #expect(release.promotions.isEmpty)
    }

    @Test func `can't send a reason longer than 500 characters`() async throws {
        let (release, deployment) = try await promotedRelease("")
        release.startPromoting(release.deployTargets[0])
        let promote = try #require(release.promote)

        promote.reason = String(repeating: "a", count: 500)
        #expect(promote.reasonExcess == 0 && promote.canSend)
        // Counted as the deployment counts: an emoji is two.
        promote.reason = String(repeating: "a", count: 499) + "🚀"
        #expect(promote.reasonExcess == 1 && !promote.canSend)

        await promote.send()
        #expect(promote.state == .confirming)
        #expect(!deployment.requests.contains(promotePath))
    }
}

struct FollowingPromotionsTests {
    @Test(.timeLimit(.minutes(1)))
    func `asks for the release again while a promotion hasn't ended, and stops once all have`() async throws {
        let (release, deployment) = try await promotedRelease("\(runningPromotion),\(endedPromotions)")
        deployment.answer(
            "GET \(feedReleasePath)", 200, promotedReleaseAnswer("\(succeededPromotion),\(endedPromotions)"))

        await release.followPromotions(every: .milliseconds(1))

        #expect(deployment.requests.filter { $0 == "GET \(feedReleasePath)" }.count == 2)
        #expect(release.promotions.first?.state == .succeeded)
        #expect(!release.hasUnendedPromotions)
    }

    @Test func `doesn't ask again when every promotion has ended`() async throws {
        let (release, deployment) = try await promotedRelease(endedPromotions)

        await release.followPromotions(every: .milliseconds(1))

        #expect(deployment.requests.filter { $0 == "GET \(feedReleasePath)" }.count == 1)
    }

    @Test(.timeLimit(.minutes(1)))
    func `stops asking when its screen leaves`() async throws {
        let (release, deployment) = try await promotedRelease(runningPromotion)

        let following = Task { await release.followPromotions(every: .seconds(60)) }
        following.cancel()
        await following.value

        #expect(deployment.requests.filter { $0 == "GET \(feedReleasePath)" }.count == 1)
        #expect(release.hasUnendedPromotions)
    }

    @Test(.timeLimit(.minutes(1)))
    func `keeps following, and showing the promotions, while the phone is offline`() async throws {
        let (release, deployment) = try await promotedRelease(runningPromotion)
        deployment.setOffline(true)

        let following = Task { await release.followPromotions(every: .milliseconds(1)) }
        while deployment.requests.filter({ $0 == "GET \(feedReleasePath)" }).count < 3 {
            await Task.yield()
        }
        following.cancel()
        await following.value

        #expect(release.detail.problem == .unreachable)
        #expect(release.promotions.first?.state == .running)
    }

    @Test(.timeLimit(.minutes(1)))
    func `follows a promotion it just started, before the release lists it`() async throws {
        let (release, deployment) = try await promotedRelease("")
        deployment.answer(promotePath, 201, startedPromotion)
        release.startPromoting(release.deployTargets[0])
        await release.promote?.send()
        #expect(release.hasUnendedPromotions)

        deployment.answer(
            "GET \(feedReleasePath)", 200,
            promotedReleaseAnswer(
                startedPromotion.replacing(
                    #""state":"starting""#, with: #""state":"cancelled","endedAt":"2026-10-21T15:01:00.000Z""#))
        )
        await release.followPromotions(every: .milliseconds(1))

        #expect(release.promotions.map(\.state) == [.cancelled])
    }
}
