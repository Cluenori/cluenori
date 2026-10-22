import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// An app's deploy targets: internal testers through TestFlight, the App Store, and a beta that
/// only App Store Connect is told about, without a workflow.
let appTargets = #"""
    [{"environment":"internal","workflow":"ios.yml",
        "appStore":{"bundleId":"com.notesapp.notes.internal","distribution":"testFlight"}},
      {"environment":"production","workflow":"ios.yml",
        "appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}},
      {"environment":"beta","appStore":{"bundleId":"com.notesapp.notes.beta","distribution":"testFlight"}}]
    """#

/// A promotion to the App Store that review approved, submitted to be released manually.
let approvedPromotion = #"""
    {"id":"019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0","component":"notes-api","release":"2026.10.21-e91f09c",
      "environment":"production","repository":"acme/notes","workflow":"ios.yml","runner":"local",
      "appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"},
      "submission":{"releaseType":"manual","phased":true},"startedBy":"m1",
      "startedAt":"2026-10-21T15:00:00.000Z","state":"approved",
      "run":{"id":11880001,"url":"https://github.com/acme/notes/actions/runs/11880001"},
      "storeVersionId":"6f1d2c3b-4a5e"}
    """#

/// The approved promotion in `state`, under another ID, ended when `ended`.
func storePromotion(_ state: String, id: String, ended: Bool = false) -> String {
    approvedPromotion
        .replacing("019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0", with: id)
        .replacing(
            #""state":"approved""#,
            with: ended ? #""state":"\#(state)","endedAt":"2026-10-22T09:00:00.000Z""# : #""state":"\#(state)""#)
}

let releaseApprovedPath = "POST /api/projects/notes/promotions/019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0/release"

/// The body of the first promotion sent.
func sentPromotion(_ deployment: FakeDeployment) throws -> [String: Any] {
    let body = try #require(deployment.bodies(promotePath).first)
    return try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
}

struct AppStorePromotionTests {
    @Test func `shows an app's deploy targets, notes, and promotions through App Store Connect and review`()
        async throws
    {
        let promotions = [
            approvedPromotion,
            storePromotion("inReview", id: "019a0f78-0000-7000-8000-000000000001"),
            storePromotion("processing", id: "019a0f70-0000-7000-8000-000000000002"),
            storePromotion("rejected", id: "019a0f68-0000-7000-8000-000000000003", ended: true),
        ]
        let (release, _) = try await promotedRelease(
            promotions.joined(separator: ","), targets: appTargets,
            notes: #"{"locale":"en-US","text":"Faster feed."},{"locale":"de-DE","text":"Schnellerer Feed."}"#)

        #expect(release.deployTargets.map(\.environment) == ["internal", "production", "beta"])
        #expect(
            release.deployTargets[1].appStore == AppStoreTarget(bundleId: "com.notesapp.notes", distribution: .appStore)
        )
        #expect(release.deployTargets[2].workflow == nil)
        #expect(release.notes.savedNotes.map(\.locale) == ["en-US", "de-DE"])
        #expect(release.promotions.map(\.state) == [.approved, .inReview, .processing, .rejected])
        // Approved waits for a member, so it hasn't ended; rejected has.
        #expect(release.promotions.map(\.hasEnded) == [false, false, false, true])
        let approved = try #require(release.promotions.first)
        #expect(approved.submission == AppStoreSubmission(releaseType: .manual, phased: true))
        #expect(approved.runner == .local)
        #expect(approved.storeVersionId == "6f1d2c3b-4a5e")
    }

    @Test func `submits to App Store review as chosen: on your Mac, released manually, not phased`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets)
        deployment.answer(promotePath, 201, storePromotion("starting", id: "019a0f90-0000-7000-8000-000000000004"))

        release.startPromoting(release.deployTargets[1])
        let promote = try #require(release.promote)
        #expect(promote.goesToReview)
        // The defaults: Auto, as soon as approved, phased.
        #expect((promote.runner, promote.releaseType, promote.phased) == (.auto, .afterApproval, true))
        promote.runner = .local
        promote.releaseType = .manual
        promote.phased = false
        await promote.send()

        let sent = try sentPromotion(deployment)
        #expect(sent["environment"] as? String == "production")
        #expect(sent["runner"] as? String == "local")
        let submission = try #require(sent["submission"] as? [String: Any])
        #expect(submission["releaseType"] as? String == "manual")
        #expect(submission["phased"] as? Bool == false)
        #expect(release.promote == nil)
    }

    @Test func `sends TestFlight no submission, and a target without a workflow no runner`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets)
        deployment.answer(promotePath, 201, storePromotion("starting", id: "019a0f90-0000-7000-8000-000000000005"))

        release.startPromoting(release.deployTargets[0])
        #expect(release.promote?.goesToReview == false)
        await release.promote?.send()
        release.startPromoting(release.deployTargets[2])
        await release.promote?.send()

        let bodies = try deployment.bodies(promotePath).map {
            try #require(try JSONSerialization.jsonObject(with: $0) as? [String: Any])
        }
        #expect(bodies.count == 2)
        #expect(bodies[0]["runner"] as? String == "auto")
        #expect(bodies[0]["submission"] == nil)
        #expect(bodies[1]["runner"] == nil)
        #expect(bodies[1]["submission"] == nil)
    }

    @Test func `says notes are missing for App Store review, and where to fix it`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets)
        let reason = "Write the release's notes in en-US and de-DE before it goes to App Store review."
        deployment.answer(promotePath, 422, #"{"_tag":"PromotionRefused","reason":"\#(reason)","fix":"notes"}"#)

        release.startPromoting(release.deployTargets[1])
        await release.promote?.send()

        #expect(release.promote?.state == .failed(.refused(reason: reason, fix: .notes)))
    }
}

struct ReleaseNowTests {
    @Test(.timeLimit(.minutes(1)))
    func `releases an approved promotion once, shows it releasing at once, and follows it until it's live`()
        async throws
    {
        let (release, deployment) = try await promotedRelease(approvedPromotion, targets: appTargets)
        deployment.answer(
            releaseApprovedPath, 200, storePromotion("releasing", id: "019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0"))
        let approved = try #require(release.promotions.first)

        await release.releaseNow(approved)
        // Released already: it isn't approved any more, whatever the copy given says.
        await release.releaseNow(approved)

        #expect(release.promotions.first?.state == .releasing)
        #expect(release.releasingNow.isEmpty)
        #expect(deployment.requests.filter { $0 == releaseApprovedPath }.count == 1)
        // Releasing hasn't ended: followed still, until the deployment sees it live.
        #expect(release.hasUnendedPromotions)
        deployment.answer(
            "GET \(feedReleasePath)", 200,
            promotedReleaseAnswer(
                storePromotion("succeeded", id: "019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0", ended: true),
                targets: appTargets))
        await release.followPromotions(every: .milliseconds(1))
        #expect(release.promotions.first?.state == .succeeded)
    }

    @Test func `says when a promotion isn't waiting to be released any more, and asks for the release again`()
        async throws
    {
        let (release, deployment) = try await promotedRelease(approvedPromotion, targets: appTargets)
        deployment.answer(
            releaseApprovedPath, 404,
            #"{"_tag":"PromotionNotFound","promotion":"019a0f80-3e00-7e50-8f60-5b6c7d8e9fa0"}"#)
        let approved = try #require(release.promotions.first)

        await release.releaseNow(approved)

        #expect(release.releasingNow[approved.id] == .failed(.notWaitingForRelease))
        #expect(deployment.requests.filter { $0 == "GET \(feedReleasePath)" }.count == 2)
    }

    @Test func `says App Store Connect refused it, or the phone is offline, and nothing waits to be sent`()
        async throws
    {
        let (release, deployment) = try await promotedRelease(approvedPromotion, targets: appTargets)
        let reason = "Cluenori has no App Store Connect key that may release builds."
        deployment.answer(
            releaseApprovedPath, 422, #"{"_tag":"PromotionRefused","reason":"\#(reason)","fix":"appStore"}"#)
        let approved = try #require(release.promotions.first)

        await release.releaseNow(approved)
        #expect(release.releasingNow[approved.id] == .failed(.refused(reason: reason, fix: .appStore)))

        deployment.setOffline(true)
        await release.releaseNow(approved)
        #expect(release.releasingNow[approved.id] == .failed(.unreachable))
        #expect(deployment.requests.filter { $0 == releaseApprovedPath }.count == 2)
    }

    @Test func `releases only a promotion that is approved`() async throws {
        let (release, deployment) = try await promotedRelease(runningPromotion, targets: appTargets)

        await release.releaseNow(try #require(release.promotions.first))

        #expect(!deployment.requests.contains { $0.hasSuffix("/release") })
        #expect(release.releasingNow.isEmpty)
    }
}
