import CluenoriClient
import CluenoriScreens
import Foundation
import Security

/// The paired deployment, kept in this phone's Keychain: readable once the phone has been unlocked
/// after starting, so a push can use it while locked, and never restored onto another device.
struct KeychainStore: PairingStore {
    /// A Keychain call failed with `status`, an `OSStatus`.
    struct Failure: Error {
        let status: OSStatus
    }

    private var item: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "cluenori.pairing",
            kSecAttrAccount as String: "deployment",
        ]
    }

    func load() throws -> PairedDeployment? {
        var query = item
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw Failure(status: status)
        }
        return try JSONDecoder().decode(PairedDeployment.self, from: data)
    }

    func save(_ deployment: PairedDeployment) throws {
        try remove()
        var attributes = item
        attributes[kSecValueData as String] = try JSONEncoder().encode(deployment)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw Failure(status: status)
        }
    }

    func remove() throws {
        let status = SecItemDelete(item as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure(status: status)
        }
    }
}
