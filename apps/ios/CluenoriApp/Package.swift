// swift-tools-version: 6.4
import PackageDescription

// The iOS app's code, in three layers, each depending only on the one below: what it shows
// (CluenoriViews, SwiftUI), what each screen holds and does (CluenoriScreens), and its client of
// the API (CluenoriClient). The last two use Foundation and Observation alone, so they build and
// test on Linux too, for a Swift CLI or an Android app later. The views name each screen and
// feature, and say when each shows its data, to the app's own telemetry: Cluenori's Swift SDK, at
// the exact version the app target links too.

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
    dependencies: [
        .package(url: "https://github.com/Cluenori/cluenori-swift", exact: "0.2.1")
    ],
    targets: [
        .target(name: "CluenoriClient", swiftSettings: strict),
        .target(name: "CluenoriScreens", dependencies: ["CluenoriClient"], swiftSettings: onMainActor),
        .target(
            name: "CluenoriViews",
            dependencies: [
                "CluenoriScreens", "CluenoriClient",
                .product(name: "Cluenori", package: "cluenori-swift"),
                .product(name: "CluenoriAnalytics", package: "cluenori-swift"),
                .product(name: "CluenoriPerformance", package: "cluenori-swift"),
            ],
            resources: [.process("Resources")],
            swiftSettings: onMainActor
        ),
        .testTarget(name: "CluenoriClientTests", dependencies: ["CluenoriClient"], swiftSettings: strict),
        .testTarget(name: "CluenoriScreensTests", dependencies: ["CluenoriScreens"], swiftSettings: onMainActor),
    ],
    swiftLanguageModes: [.v6]
)
