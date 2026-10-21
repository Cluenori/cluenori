import CluenoriClient
import Foundation

extension PhoneDetails {
    /// What this phone says about itself: its model, its iOS version, and the app's version and
    /// build, from the app's Info.plist.
    static var thisPhone: PhoneDetails {
        guard let info = Bundle.main.infoDictionary,
            let version = info["CFBundleShortVersionString"] as? String,
            let build = info["CFBundleVersion"] as? String
        else {
            preconditionFailure(
                "The app's Info.plist has no version: set MARKETING_VERSION and CURRENT_PROJECT_VERSION.")
        }
        let system = ProcessInfo.processInfo.operatingSystemVersion
        let systemVersion =
            system.patchVersion == 0
            ? "\(system.majorVersion).\(system.minorVersion)"
            : "\(system.majorVersion).\(system.minorVersion).\(system.patchVersion)"
        return PhoneDetails(model: modelIdentifier, systemVersion: systemVersion, appVersion: "\(version) (\(build))")
    }

    /// Apple's identifier of this phone's model, `iPhone19,3`; in the simulator, the one it simulates.
    private static var modelIdentifier: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return simulated
        }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: system.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}
