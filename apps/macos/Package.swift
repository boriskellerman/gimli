// swift-tools-version: 6.2
// Package manifest for the Gimli macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Gimli",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "GimliIPC", targets: ["GimliIPC"]),
        .library(name: "GimliDiscovery", targets: ["GimliDiscovery"]),
        .executable(name: "Gimli", targets: ["Gimli"]),
        .executable(name: "gimli-mac", targets: ["GimliMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/GimliKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "GimliIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "GimliDiscovery",
            dependencies: [
                .product(name: "GimliKit", package: "GimliKit"),
            ],
            path: "Sources/GimliDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Gimli",
            dependencies: [
                "GimliIPC",
                "GimliDiscovery",
                .product(name: "GimliKit", package: "GimliKit"),
                .product(name: "GimliChatUI", package: "GimliKit"),
                .product(name: "GimliProtocol", package: "GimliKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Gimli.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "GimliMacCLI",
            dependencies: [
                "GimliDiscovery",
                .product(name: "GimliKit", package: "GimliKit"),
                .product(name: "GimliProtocol", package: "GimliKit"),
            ],
            path: "Sources/GimliMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "GimliIPCTests",
            dependencies: [
                "GimliIPC",
                "Gimli",
                "GimliDiscovery",
                .product(name: "GimliProtocol", package: "GimliKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
