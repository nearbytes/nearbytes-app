import Foundation
import Capacitor

@objc(NearbytesLanPlugin)
public class NearbytesLanPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    public let identifier = "NearbytesLanPlugin"
    public let jsName = "NearbytesLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listPeers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "postSignal", returnType: CAPPluginReturnPromise)
    ]

    private var browser: NetServiceBrowser?
    private var servicesByKey: [String: NetService] = [:]
    private var peersById: [String: LanDiscoveredPeer] = [:]

    override public func load() {
        super.load()
        startBrowser()
    }

    deinit {
        browser?.stop()
    }

    @objc func listPeers(_ call: CAPPluginCall) {
        call.resolve([
            "peers": peersById.values
                .sorted(by: { left, right in
                    if left.lastSeenAt == right.lastSeenAt {
                        return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
                    }
                    return left.lastSeenAt > right.lastSeenAt
                })
                .map { $0.jsObject }
        ])
    }

    @objc func postSignal(_ call: CAPPluginCall) {
        guard let address = call.getString("address")?.trimmingCharacters(in: .whitespacesAndNewlines), !address.isEmpty else {
            call.reject("address is required")
            return
        }
        let portValue = call.getInt("port") ?? 0
        guard portValue > 0 else {
            call.reject("port is required")
            return
        }
        guard let request = call.getObject("request") else {
            call.reject("request is required")
            return
        }

        let urlString = "http://\(address):\(portValue)/lan/transport/signal"
        guard let url = URL(string: urlString) else {
            call.reject("Invalid LAN peer URL")
            return
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: request, options: [])
        } catch {
            call.reject("Failed to encode LAN signal request", nil, error)
            return
        }

        let task = URLSession.shared.dataTask(with: urlRequest) { data, response, error in
            if let error {
                call.reject("LAN signal request failed", nil, error)
                return
            }
            guard let httpResponse = response as? HTTPURLResponse else {
                call.reject("LAN signal response was not HTTP")
                return
            }
            guard (200...299).contains(httpResponse.statusCode) else {
                call.reject("LAN signal request failed with status \(httpResponse.statusCode)")
                return
            }
            guard let data else {
                call.reject("LAN signal response was empty")
                return
            }
            do {
                let object = try JSONSerialization.jsonObject(with: data, options: [])
                guard let json = object as? [String: Any] else {
                    call.reject("LAN signal response was not a JSON object")
                    return
                }
                call.resolve(json)
            } catch {
                call.reject("Failed to decode LAN signal response", nil, error)
            }
        }
        task.resume()
    }

    private func startBrowser() {
        let browser = NetServiceBrowser()
        browser.delegate = self
        browser.includesPeerToPeer = true
        browser.searchForServices(ofType: "_nearbytes._udp.", inDomain: "local.")
        self.browser = browser
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        let key = serviceKey(for: service)
        service.delegate = self
        service.includesPeerToPeer = true
        servicesByKey[key] = service
        service.resolve(withTimeout: 5)
        if !moreComing {
            pruneExpiredPeers()
        }
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        servicesByKey.removeValue(forKey: serviceKey(for: service))
        let peerIdsToRemove = peersById.values
            .filter { $0.serviceName == service.name }
            .map { $0.peerId }
        for peerId in peerIdsToRemove {
            peersById.removeValue(forKey: peerId)
        }
        if !moreComing {
            pruneExpiredPeers()
        }
    }

    public func netServiceDidResolveAddress(_ sender: NetService) {
        guard let parsed = parsePeer(from: sender) else {
            return
        }
        peersById[parsed.peerId] = parsed
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String : NSNumber]) {
        servicesByKey.removeValue(forKey: serviceKey(for: sender))
    }

    private func parsePeer(from service: NetService) -> LanDiscoveredPeer? {
        guard let txtRecord = service.txtRecordData(),
              let txt = NetService.dictionary(fromTXTRecord: txtRecord) as? [String: Data] else {
            return nil
        }
        let peerId = decodeTxtValue(txt["peer"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !peerId.isEmpty else {
            return nil
        }
        let capabilities = (decodeTxtValue(txt["caps"]) ?? "")
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let headObservationId = decodeTxtValue(txt["head"])?.lowercased()

        guard let address = firstResolvedAddress(from: service.addresses) else {
            return nil
        }

        let seenAt = Int(Date().timeIntervalSince1970 * 1000)
        let existing = peersById[peerId]
        return LanDiscoveredPeer(
            peerId: peerId,
            serviceName: service.name,
            label: service.name.isEmpty ? "Nearbytes peer" : service.name,
            address: address,
            port: service.port,
            capabilities: capabilities,
            headObservationId: headObservationId,
            firstSeenAt: existing?.firstSeenAt ?? seenAt,
            lastSeenAt: seenAt
        )
    }

    private func decodeTxtValue(_ data: Data?) -> String? {
        guard let data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func pruneExpiredPeers() {
        let activeNames = Set(servicesByKey.values.map { $0.name })
        peersById = peersById.filter { _, peer in
            activeNames.contains(peer.serviceName)
        }
    }

    private func serviceKey(for service: NetService) -> String {
        "\(service.domain)|\(service.type)|\(service.name)"
    }

    private func firstResolvedAddress(from addresses: [Data]?) -> String? {
        guard let addresses else {
            return nil
        }
        for data in addresses {
            let host = data.withUnsafeBytes { rawBuffer -> String? in
                guard let baseAddress = rawBuffer.baseAddress else {
                    return nil
                }
                var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                let result = getnameinfo(
                    baseAddress.assumingMemoryBound(to: sockaddr.self),
                    socklen_t(data.count),
                    &hostBuffer,
                    socklen_t(hostBuffer.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                )
                guard result == 0 else {
                    return nil
                }
                return String(cString: hostBuffer)
            }
            if let host, !host.isEmpty {
                return host
            }
        }
        return nil
    }
}

private struct LanDiscoveredPeer {
    let peerId: String
    let serviceName: String
    let label: String
    let address: String
    let port: Int
    let capabilities: [String]
    let headObservationId: String?
    let firstSeenAt: Int
    let lastSeenAt: Int

    var jsObject: [String: Any] {
        [
            "peerId": peerId,
            "label": label,
            "address": address,
            "port": port,
            "capabilities": capabilities,
            "headObservationId": headObservationId as Any,
            "firstSeenAt": firstSeenAt,
            "lastSeenAt": lastSeenAt,
        ]
    }
}