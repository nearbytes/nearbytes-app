import Foundation
import Capacitor

@objc(NearbytesProviderPlugin)
public class NearbytesProviderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NearbytesProviderPlugin"
    public let jsName = "NearbytesProvider"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSetupState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureProvider", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installProvider", returnType: CAPPluginReturnPromise)
    ]

    private let defaults = UserDefaults.standard
    private let clientIdPrefix = "org.nearbytes.provider.clientId."
    private let clientSecretPrefix = "org.nearbytes.provider.clientSecret."

    @objc func getSetupState(_ call: CAPPluginCall) {
        guard let provider = normalizedProvider(from: call) else {
            call.reject("provider is required")
            return
        }
        call.resolve(["setup": setupState(for: provider)])
    }

    @objc func configureProvider(_ call: CAPPluginCall) {
        guard let provider = normalizedProvider(from: call) else {
            call.reject("provider is required")
            return
        }

        if let clientId = trimmedOptional(call.getString("clientId")) {
            defaults.set(clientId, forKey: clientIdKey(for: provider))
        } else {
            defaults.removeObject(forKey: clientIdKey(for: provider))
        }

        if let clientSecret = trimmedOptional(call.getString("clientSecret")) {
            defaults.set(clientSecret, forKey: clientSecretKey(for: provider))
        } else {
            defaults.removeObject(forKey: clientSecretKey(for: provider))
        }

        call.resolve(["setup": setupState(for: provider)])
    }

    @objc func installProvider(_ call: CAPPluginCall) {
        guard let provider = normalizedProvider(from: call) else {
            call.reject("provider is required")
            return
        }
        call.resolve(["setup": setupState(for: provider)])
    }

    private func normalizedProvider(from call: CAPPluginCall) -> String? {
        guard let raw = trimmedOptional(call.getString("provider")) else {
            return nil
        }
        switch raw.lowercased() {
        case "google-drive", "google_drive", "googledrive":
            return "gdrive"
        default:
            return raw.lowercased()
        }
    }

    private func setupState(for provider: String) -> JSObject {
        switch provider {
        case "mega":
            return [
                "status": "ready",
                "detail": "MEGA native sync is built in. No separate local helper install is required."
            ]
        case "gdrive":
            let clientId = trimmedOptional(defaults.string(forKey: clientIdKey(for: provider)))
            let hasClientSecret = trimmedOptional(defaults.string(forKey: clientSecretKey(for: provider))) != nil
            if let clientId {
                return [
                    "status": "ready",
                    "detail": "Google Drive is ready to connect.",
                    "docsUrl": "https://console.cloud.google.com/apis/credentials",
                    "canConfigure": true,
                    "config": [
                        "clientId": clientId,
                        "hasClientSecret": hasClientSecret
                    ]
                ]
            }
            return [
                "status": "needs-config",
                "detail": "Google Drive needs a Desktop app OAuth client ID. Nearbytes uses PKCE, so no client secret is required.",
                "docsUrl": "https://console.cloud.google.com/apis/credentials",
                "canConfigure": true,
                "config": [
                    "hasClientSecret": hasClientSecret
                ]
            ]
        case "github":
            let clientId = trimmedOptional(defaults.string(forKey: clientIdKey(for: provider)))
            if let clientId {
                return [
                    "status": "ready",
                    "detail": "GitHub is ready to connect.",
                    "docsUrl": "https://github.com/settings/applications/new",
                    "canConfigure": true,
                    "config": [
                        "clientId": clientId
                    ]
                ]
            }
            return [
                "status": "needs-config",
                "detail": "GitHub needs an OAuth app client ID with device flow enabled.",
                "docsUrl": "https://github.com/settings/applications/new",
                "canConfigure": true,
                "config": [:]
            ]
        default:
            return [
                "status": "unsupported",
                "detail": "\(provider) setup is not available on this device yet."
            ]
        }
    }

    private func clientIdKey(for provider: String) -> String {
        return clientIdPrefix + provider
    }

    private func clientSecretKey(for provider: String) -> String {
        return clientSecretPrefix + provider
    }

    private func trimmedOptional(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}