import GimliKit
import GimliProtocol
import Foundation

// Prefer the GimliKit wrapper to keep gateway request payloads consistent.
typealias AnyCodable = GimliKit.AnyCodable
typealias InstanceIdentity = GimliKit.InstanceIdentity

extension AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: AnyCodable]? { self.value as? [String: AnyCodable] }
    var arrayValue: [AnyCodable]? { self.value as? [AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}

extension GimliProtocol.AnyCodable {
    var stringValue: String? { self.value as? String }
    var boolValue: Bool? { self.value as? Bool }
    var intValue: Int? { self.value as? Int }
    var doubleValue: Double? { self.value as? Double }
    var dictionaryValue: [String: GimliProtocol.AnyCodable]? { self.value as? [String: GimliProtocol.AnyCodable] }
    var arrayValue: [GimliProtocol.AnyCodable]? { self.value as? [GimliProtocol.AnyCodable] }

    var foundationValue: Any {
        switch self.value {
        case let dict as [String: GimliProtocol.AnyCodable]:
            dict.mapValues { $0.foundationValue }
        case let array as [GimliProtocol.AnyCodable]:
            array.map(\.foundationValue)
        default:
            self.value
        }
    }
}
