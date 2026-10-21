// swift-tools-version: 6.4
import PackageDescription

// The iOS app's code, in three layers, each depending only on the one below: what it shows
// (CluenoriViews, SwiftUI), what each screen holds and does (CluenoriScreens), and its client of
// the API (CluenoriClient). The last two use Foundation and Observation alone, so they build and
// test on Linux too, for a Swift CLI or an Android app later.

// Every target: Swift 6, its concurrency checked, and every warning an error.
let strict: [SwiftSetting] = [
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
    .enableUpcomingFeature("ExistentialAny"),
    .enableUpcomingFeature("MemberImportVisibility"),
    .treatAllWarnings(as: .error),
]

// Screens and views run on the main actor unless they say otherwise.
let onMainActor: [SwiftSetting] = strict + [.defaultIsolation(MainActor.self)]

let package = Package(
    name: "CluenoriApp",
    defaultLocalization: "en",
    platforms: [.iOS(.v27), .macOS(.v27)],
    products: [
        .library(name: "CluenoriClient", targets: ["CluenoriClient"]),
        .library(name: "CluenoriScreens", targets: ["CluenoriScreens"]),
        .library(name: "CluenoriViews", targets: ["CluenoriViews"]),
    ],
    targets: [
        .target(name: "CluenoriClient", swiftSettings: strict),
        .target(name: "CluenoriScreens", dependencies: ["CluenoriClient"], swiftSettings: onMainActor),
        .target(
            name: "CluenoriViews",
            dependencies: ["CluenoriScreens", "CluenoriClient"],
            resources: [.process("Resources")],
            swiftSettings: onMainActor
        ),
        .testTarget(name: "CluenoriClientTests", dependencies: ["CluenoriClient"], swiftSettings: strict),
        .testTarget(name: "CluenoriScreensTests", dependencies: ["CluenoriScreens"], swiftSettings: onMainActor),
    ],
    swiftLanguageModes: [.v6]
)
