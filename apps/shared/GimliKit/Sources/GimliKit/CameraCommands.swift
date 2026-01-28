import Foundation

public enum GimliCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum GimliCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum GimliCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum GimliCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct GimliCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: GimliCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: GimliCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: GimliCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: GimliCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct GimliCameraClipParams: Codable, Sendable, Equatable {
    public var facing: GimliCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: GimliCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: GimliCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: GimliCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
