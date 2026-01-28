import Foundation

public enum GimliChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(GimliChatEventPayload)
    case agent(GimliAgentEventPayload)
    case seqGap
}

public protocol GimliChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> GimliChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [GimliChatAttachmentPayload]) async throws -> GimliChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> GimliChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<GimliChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension GimliChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "GimliChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> GimliChatSessionsListResponse {
        throw NSError(
            domain: "GimliChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
