import Foundation

public struct GimliChatSessionsDefaults: Codable, Sendable {
    public let model: String?
    public let contextTokens: Int?
}

public struct GimliChatSessionEntry: Codable, Identifiable, Sendable, Hashable {
    public var id: String { self.key }

    public let key: String
    public let kind: String?
    public let displayName: String?
    public let surface: String?
    public let subject: String?
    public let room: String?
    public let space: String?
    public let updatedAt: Double?
    public let sessionId: String?

    public let systemSent: Bool?
    public let abortedLastRun: Bool?
    public let thinkingLevel: String?
    public let verboseLevel: String?

    public let inputTokens: Int?
    public let outputTokens: Int?
    public let totalTokens: Int?

    public let model: String?
    public let contextTokens: Int?
}

public struct GimliChatSessionsListResponse: Codable, Sendable {
    public let ts: Double?
    public let path: String?
    public let count: Int?
    public let defaults: GimliChatSessionsDefaults?
    public let sessions: [GimliChatSessionEntry]
}
