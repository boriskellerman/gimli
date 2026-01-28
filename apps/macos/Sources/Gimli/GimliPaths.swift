import Foundation

enum GimliEnv {
    static func path(_ key: String) -> String? {
        // Normalize env overrides once so UI + file IO stay consistent.
        guard let raw = getenv(key) else { return nil }
        let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty
        else {
            return nil
        }
        return value
    }
}

enum GimliPaths {
    private static let configPathEnv = "GIMLI_CONFIG_PATH"
    private static let stateDirEnv = "GIMLI_STATE_DIR"

    static var stateDirURL: URL {
        if let override = GimliEnv.path(self.stateDirEnv) {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager().homeDirectoryForCurrentUser
            .appendingPathComponent(".gimli", isDirectory: true)
    }

    static var configURL: URL {
        if let override = GimliEnv.path(self.configPathEnv) {
            return URL(fileURLWithPath: override)
        }
        return self.stateDirURL.appendingPathComponent("gimli.json")
    }

    static var workspaceURL: URL {
        self.stateDirURL.appendingPathComponent("workspace", isDirectory: true)
    }
}
