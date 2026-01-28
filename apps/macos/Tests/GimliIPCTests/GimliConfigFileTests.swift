import Foundation
import Testing
@testable import Gimli

@Suite(.serialized)
struct GimliConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("gimli-config-\(UUID().uuidString)")
            .appendingPathComponent("gimli.json")
            .path

        await TestIsolation.withEnvValues(["GIMLI_CONFIG_PATH": override]) {
            #expect(GimliConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("gimli-config-\(UUID().uuidString)")
            .appendingPathComponent("gimli.json")
            .path

        await TestIsolation.withEnvValues(["GIMLI_CONFIG_PATH": override]) {
            GimliConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(GimliConfigFile.remoteGatewayPort() == 19999)
            #expect(GimliConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(GimliConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(GimliConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("gimli-config-\(UUID().uuidString)")
            .appendingPathComponent("gimli.json")
            .path

        await TestIsolation.withEnvValues(["GIMLI_CONFIG_PATH": override]) {
            GimliConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            GimliConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = GimliConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("gimli-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "GIMLI_CONFIG_PATH": nil,
            "GIMLI_STATE_DIR": dir,
        ]) {
            #expect(GimliConfigFile.stateDirURL().path == dir)
            #expect(GimliConfigFile.url().path == "\(dir)/gimli.json")
        }
    }
}
