import Foundation
import Capacitor
import Network

@objc(NearbytesLanPlugin)
public class NearbytesLanPlugin: CAPPlugin, CAPBridgedPlugin, NetServiceBrowserDelegate, NetServiceDelegate {
    private let peerExpiryMs = 20_000
    public let identifier = "NearbytesLanPlugin"
    public let jsName = "NearbytesLan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listPeers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAutomationCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAutomationCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAutomationResult", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "postSignal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRuntime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRuntime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completeSignalRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]

    private let serviceType = "_nearbytes._udp."
    private let serviceDomain = "local."
    private let signalQueue = DispatchQueue(label: "org.nearbytes.mobile.lan.signal")
    private let pendingSignalLock = NSLock()
    private let automationDirectoryName = "nearbytes-dev-automation"
    private let automationCommandFileName = "command.json"
    private let automationResultFileName = "result.json"

    private var browser: NetServiceBrowser?
    private var servicesByKey: [String: NetService] = [:]
    private var resolvingServiceKeys = Set<String>()
    private var peersById: [String: LanDiscoveredPeer] = [:]
    private var advertisedPeerId: String?
    private var publishedService: NetService?
    private var signalListener: NWListener?
    private var signalListenerPort: Int?
    private var pendingSignalRequests: [String: PendingSignalRequest] = [:]

    override public func load() {
        super.load()
        startBrowserIfNeeded()
    }

    deinit {
        browser?.stop()
        stopRuntimeResources()
    }

    @objc func listPeers(_ call: CAPPluginCall) {
        startBrowserIfNeeded()
        refreshResolvableServices()
        pruneExpiredPeers()
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

    @objc func getAutomationCommand(_ call: CAPPluginCall) {
        let value = readAutomationFile(named: automationCommandFileName)
        if let value {
            call.resolve(["value": value])
            return
        }
        call.resolve(["value": NSNull()])
    }

    @objc func clearAutomationCommand(_ call: CAPPluginCall) {
        removeAutomationFile(named: automationCommandFileName)
        call.resolve()
    }

    @objc func setAutomationResult(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("value is required")
            return
        }
        writeAutomationFile(value, named: automationResultFileName)
        call.resolve()
    }

    @objc func startRuntime(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId")?.trimmingCharacters(in: .whitespacesAndNewlines), !peerId.isEmpty else {
            call.reject("peerId is required")
            return
        }
        let label = call.getString("label")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Nearbytes phone"
        let announceIntervalMs = max(call.getInt("announceIntervalMs") ?? 5_000, 1_000)
        guard let txtRecord = call.getObject("txtRecord") else {
            call.reject("txtRecord is required")
            return
        }

        do {
            startBrowserIfNeeded()
            let port = try ensureSignalListenerStarted()
            advertisedPeerId = peerId
            publishService(peerId: peerId, label: label, port: port, txtRecord: txtRecord)
            NSLog("[Nearbytes LAN][iPhone] native runtime started peer=%@ port=%d address=%@", peerId, port, bestLocalIPv4Address() ?? "unknown")
            var response: JSObject = [
                "listening": true,
                "port": port,
                "announceIntervalMs": announceIntervalMs,
                "serviceType": serviceType.trimmingCharacters(in: CharacterSet(charactersIn: ".")),
            ]
            if let address = bestLocalIPv4Address() {
                response["address"] = address
            } else {
                response["address"] = NSNull()
            }
            call.resolve(response)
        } catch {
            call.reject("Failed to start native LAN runtime", nil, error)
        }
    }

    @objc func stopRuntime(_ call: CAPPluginCall) {
        stopRuntimeResources()
        call.resolve()
    }

    @objc func completeSignalRequest(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId")?.trimmingCharacters(in: .whitespacesAndNewlines), !requestId.isEmpty else {
            call.reject("requestId is required")
            return
        }

        pendingSignalLock.lock()
        defer { pendingSignalLock.unlock() }
        guard let pending = pendingSignalRequests[requestId] else {
            call.reject("Unknown signal request id")
            return
        }

        if let errorMessage = call.getString("error")?.trimmingCharacters(in: .whitespacesAndNewlines), !errorMessage.isEmpty {
            pending.error = errorMessage
            pending.semaphore.signal()
            call.resolve()
            return
        }

        if let response = call.getObject("response") {
            pending.response = response
            pending.semaphore.signal()
            call.resolve()
            return
        }

        call.reject("response or error is required")
    }

    private func startBrowserIfNeeded() {
        guard browser == nil else {
            return
        }
        let browser = NetServiceBrowser()
        browser.delegate = self
        browser.includesPeerToPeer = true
        browser.searchForServices(ofType: serviceType, inDomain: serviceDomain)
        self.browser = browser
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        let key = serviceKey(for: service)
        service.delegate = self
        service.includesPeerToPeer = true
        servicesByKey[key] = service
        resolvingServiceKeys.insert(key)
        NSLog("[Nearbytes LAN][iPhone] found service %@ type=%@ domain=%@ port=%ld", service.name, service.type, service.domain, service.port)
        service.resolve(withTimeout: 5)
        if !moreComing {
            pruneExpiredPeers()
        }
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        let key = serviceKey(for: service)
        servicesByKey.removeValue(forKey: key)
        resolvingServiceKeys.remove(key)
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
        resolvingServiceKeys.remove(serviceKey(for: sender))
        guard let parsed = parsePeer(from: sender) else {
            return
        }
        if parsed.peerId == advertisedPeerId {
            return
        }
        peersById[parsed.peerId] = parsed
        NSLog("[Nearbytes LAN][iPhone] discovered peer %@ at %@:%d", parsed.peerId, parsed.address, parsed.port)
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String : NSNumber]) {
        let key = serviceKey(for: sender)
        servicesByKey.removeValue(forKey: key)
        resolvingServiceKeys.remove(key)
        NSLog("[Nearbytes LAN][iPhone] failed to resolve service %@ errors=%@", sender.name, String(describing: errorDict))
    }

    private func refreshResolvableServices() {
        let resolvedServiceNames = Set(peersById.values.map { $0.serviceName })
        for (key, service) in servicesByKey {
            if resolvedServiceNames.contains(service.name) || resolvingServiceKeys.contains(key) {
                continue
            }
            service.delegate = self
            service.includesPeerToPeer = true
            resolvingServiceKeys.insert(key)
            service.resolve(withTimeout: 5)
        }
    }

    private func ensureSignalListenerStarted() throws -> Int {
        if let port = signalListenerPort, signalListener != nil {
            return port
        }

        let listener = try NWListener(using: .tcp)
        let readySemaphore = DispatchSemaphore(value: 0)
        var readyPort: Int?
        var startError: Error?

        listener.newConnectionHandler = { [weak self] connection in
            self?.handleIncomingConnection(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                readyPort = listener.port.map { Int($0.rawValue) }
                readySemaphore.signal()
            case .failed(let error):
                startError = error
                self?.signalListener = nil
                self?.signalListenerPort = nil
                readySemaphore.signal()
            case .cancelled:
                self?.signalListener = nil
                self?.signalListenerPort = nil
            default:
                break
            }
        }

        listener.start(queue: signalQueue)
        _ = readySemaphore.wait(timeout: .now() + 5)
        if let startError {
            throw startError
        }
        guard let readyPort, readyPort > 0 else {
            throw LanPluginError.listenerDidNotStart
        }
        signalListener = listener
        signalListenerPort = readyPort
        return readyPort
    }

    private func stopRuntimeResources() {
        advertisedPeerId = nil
        publishedService?.stop()
        publishedService = nil
        signalListener?.cancel()
        signalListener = nil
        signalListenerPort = nil
        pendingSignalLock.lock()
        let pending = pendingSignalRequests.values
        pendingSignalRequests.removeAll()
        pendingSignalLock.unlock()
        for request in pending {
            request.error = "Native LAN runtime stopped"
            request.semaphore.signal()
        }
    }

    private func publishService(peerId: String, label: String, port: Int, txtRecord: JSObject) {
        publishedService?.stop()

        let service = NetService(domain: serviceDomain, type: serviceType, name: label.isEmpty ? peerId : label, port: Int32(port))
        service.includesPeerToPeer = true
        service.delegate = self
        var publishedTxtRecord = txtRecord
        if let address = bestLocalIPv4Address() {
            publishedTxtRecord["addr"] = address
        }
        let encodedRecord = Self.makeTxtRecord(from: publishedTxtRecord)
        service.setTXTRecord(encodedRecord)
        service.publish()
        publishedService = service
        NSLog("[Nearbytes LAN][iPhone] publishing peer %@ on %@:%d", peerId, publishedTxtRecord["addr"] as? String ?? "unknown", port)
    }

    private func handleIncomingConnection(_ connection: NWConnection) {
        connection.start(queue: signalQueue)
        receiveHttpRequest(on: connection, buffer: Data())
    }

    private func receiveHttpRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            if let error {
                connection.cancel()
                NSLog("[Nearbytes LAN][iPhone] incoming signal receive failed: %@", String(describing: error))
                return
            }
            var nextBuffer = buffer
            if let data, !data.isEmpty {
                nextBuffer.append(data)
            }
            if let request = self.parseHttpRequest(nextBuffer) {
                self.forwardSignalRequest(request, connection: connection)
                return
            }
            if isComplete {
                self.sendHttpResponse(on: connection, statusCode: 400, body: "Invalid LAN signal request")
                return
            }
            self.receiveHttpRequest(on: connection, buffer: nextBuffer)
        }
    }

    private func forwardSignalRequest(_ httpRequest: ParsedHttpRequest, connection: NWConnection) {
        guard httpRequest.method == "POST", httpRequest.path == "/lan/transport/signal" else {
            sendHttpResponse(on: connection, statusCode: 404, body: "Not Found")
            return
        }

        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: httpRequest.body, options: [])
        } catch {
            sendHttpResponse(on: connection, statusCode: 400, body: "Invalid JSON body")
            return
        }
        guard let requestObject = object as? [String: Any] else {
            sendHttpResponse(on: connection, statusCode: 400, body: "LAN signal request body must be a JSON object")
            return
        }

        let requestId = UUID().uuidString.lowercased()
        let pending = PendingSignalRequest()
        pendingSignalLock.lock()
        pendingSignalRequests[requestId] = pending
        pendingSignalLock.unlock()

        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("incomingSignal", data: [
                "requestId": requestId,
                "request": requestObject,
            ], retainUntilConsumed: true)
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else {
                connection.cancel()
                return
            }
            let status = pending.semaphore.wait(timeout: .now() + 15)
            self.pendingSignalLock.lock()
            let completed = self.pendingSignalRequests.removeValue(forKey: requestId)
            self.pendingSignalLock.unlock()
            guard let completed else {
                self.sendHttpResponse(on: connection, statusCode: 500, body: "Missing pending LAN signal response")
                return
            }
            if status == .timedOut {
                self.sendHttpResponse(on: connection, statusCode: 504, body: "Timed out waiting for LAN signal response")
                return
            }
            if let error = completed.error, !error.isEmpty {
                self.sendHttpResponse(on: connection, statusCode: 500, body: error)
                return
            }
            guard let response = completed.response else {
                self.sendHttpResponse(on: connection, statusCode: 500, body: "Missing LAN signal response body")
                return
            }
            self.sendHttpJsonResponse(on: connection, statusCode: 200, object: response)
        }
    }

    private func sendHttpJsonResponse(on connection: NWConnection, statusCode: Int, object: JSObject) {
        do {
            let body = try JSONSerialization.data(withJSONObject: object, options: [])
            var header = "HTTP/1.1 \(statusCode) \(reasonPhrase(for: statusCode))\r\n"
            header += "Content-Type: application/json\r\n"
            header += "Content-Length: \(body.count)\r\n"
            header += "Connection: close\r\n\r\n"
            var response = Data(header.utf8)
            response.append(body)
            connection.send(content: response, completion: .contentProcessed({ _ in
                connection.cancel()
            }))
        } catch {
            sendHttpResponse(on: connection, statusCode: 500, body: "Failed to encode LAN signal response")
        }
    }

    private func sendHttpResponse(on connection: NWConnection, statusCode: Int, body: String) {
        let bodyData = Data(body.utf8)
        var header = "HTTP/1.1 \(statusCode) \(reasonPhrase(for: statusCode))\r\n"
        header += "Content-Type: text/plain; charset=utf-8\r\n"
        header += "Content-Length: \(bodyData.count)\r\n"
        header += "Connection: close\r\n\r\n"
        var response = Data(header.utf8)
        response.append(bodyData)
        connection.send(content: response, completion: .contentProcessed({ _ in
            connection.cancel()
        }))
    }

    private func parseHttpRequest(_ data: Data) -> ParsedHttpRequest? {
        guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }
        let headerData = data.subdata(in: 0..<headerRange.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else {
            return nil
        }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return nil
        }
        let requestParts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard requestParts.count >= 2 else {
            return nil
        }
        let method = String(requestParts[0]).uppercased()
        let path = String(requestParts[1])

        var contentLength = 0
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else {
                continue
            }
            let name = parts[0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
            if name == "content-length" {
                contentLength = Int(value) ?? 0
            }
        }

        let bodyStart = headerRange.upperBound
        guard data.count >= bodyStart + contentLength else {
            return nil
        }
        let body = data.subdata(in: bodyStart..<(bodyStart + contentLength))
        return ParsedHttpRequest(method: method, path: path, body: body)
    }

    private func parsePeer(from service: NetService) -> LanDiscoveredPeer? {
        guard let txtRecord = service.txtRecordData(),
              let txt = NetService.dictionary(fromTXTRecord: txtRecord) as? [String: Data] else {
            NSLog("[Nearbytes LAN][iPhone] service %@ missing TXT record", service.name)
            return nil
        }
        let peerId = decodeTxtValue(txt["peer"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !peerId.isEmpty else {
            NSLog("[Nearbytes LAN][iPhone] service %@ missing peer id in TXT", service.name)
            return nil
        }
        let capabilities = (decodeTxtValue(txt["caps"]) ?? "")
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let headObservationId = decodeTxtValue(txt["head"])?.lowercased()
        let explicitAddress = decodeTxtValue(txt["addr"])?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let address = (explicitAddress?.isEmpty == false ? explicitAddress : nil) ?? firstResolvedAddress(from: service.addresses)
        guard let address, !address.isEmpty else {
            NSLog("[Nearbytes LAN][iPhone] service %@ peer=%@ has no usable address explicit=%@ resolved=%@", service.name, peerId, explicitAddress ?? "", String(describing: service.addresses))
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
        let now = Int(Date().timeIntervalSince1970 * 1000)
        let deadline = now - peerExpiryMs
        peersById = peersById.reduce(into: [:]) { partialResult, entry in
            let peerId = entry.key
            let peer = entry.value
            if activeNames.contains(peer.serviceName) {
                partialResult[peerId] = LanDiscoveredPeer(
                    peerId: peer.peerId,
                    serviceName: peer.serviceName,
                    label: peer.label,
                    address: peer.address,
                    port: peer.port,
                    capabilities: peer.capabilities,
                    headObservationId: peer.headObservationId,
                    firstSeenAt: peer.firstSeenAt,
                    lastSeenAt: now
                )
                return
            }
            if peer.lastSeenAt >= deadline {
                partialResult[peerId] = peer
            }
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
            if let host,
               !host.isEmpty,
               host != "0.0.0.0",
               host != "::1",
               host != "127.0.0.1" {
                return host
            }
        }
        return nil
    }

    private static func makeTxtRecord(from object: JSObject) -> Data {
        let record = object.reduce(into: [String: Data]()) { partialResult, entry in
            let value = String(describing: entry.value)
            partialResult[entry.key] = Data(value.utf8)
        }
        return NetService.data(fromTXTRecord: record)
    }

    private func reasonPhrase(for statusCode: Int) -> String {
        switch statusCode {
        case 200:
            return "OK"
        case 400:
            return "Bad Request"
        case 404:
            return "Not Found"
        case 500:
            return "Internal Server Error"
        case 504:
            return "Gateway Timeout"
        default:
            return "HTTP"
        }
    }

    private func automationDirectoryUrl() -> URL? {
        guard let libraryUrl = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            return nil
        }
        let directoryUrl = libraryUrl
            .appendingPathComponent("Application Support")
            .appendingPathComponent(automationDirectoryName)
        do {
            try FileManager.default.createDirectory(at: directoryUrl, withIntermediateDirectories: true)
            return directoryUrl
        } catch {
            NSLog("[Nearbytes LAN][iPhone] failed to create automation directory: %@", String(describing: error))
            return nil
        }
    }

    private func automationFileUrl(named fileName: String) -> URL? {
        automationDirectoryUrl()?.appendingPathComponent(fileName)
    }

    private func readAutomationFile(named fileName: String) -> String? {
        guard let fileUrl = automationFileUrl(named: fileName),
              let data = try? Data(contentsOf: fileUrl),
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private func writeAutomationFile(_ value: String, named fileName: String) {
        guard let fileUrl = automationFileUrl(named: fileName) else {
            return
        }
        do {
            try Data(value.utf8).write(to: fileUrl, options: .atomic)
        } catch {
            NSLog("[Nearbytes LAN][iPhone] failed to write automation file %@: %@", fileName, String(describing: error))
        }
    }

    private func removeAutomationFile(named fileName: String) {
        guard let fileUrl = automationFileUrl(named: fileName) else {
            return
        }
        try? FileManager.default.removeItem(at: fileUrl)
    }
}

private final class PendingSignalRequest {
    let semaphore = DispatchSemaphore(value: 0)
    var response: JSObject?
    var error: String?
}

private struct ParsedHttpRequest {
    let method: String
    let path: String
    let body: Data
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

private enum LanPluginError: Error {
    case listenerDidNotStart
}

private func bestLocalIPv4Address() -> String? {
    var interfaces: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaces) == 0, let first = interfaces else {
        return nil
    }
    defer {
        freeifaddrs(interfaces)
    }

    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let current = cursor {
        defer { cursor = current.pointee.ifa_next }
        let flags = Int32(current.pointee.ifa_flags)
        let isUp = (flags & IFF_UP) != 0
        let isLoopback = (flags & IFF_LOOPBACK) != 0
        guard isUp, !isLoopback,
              let address = current.pointee.ifa_addr,
              address.pointee.sa_family == UInt8(AF_INET) else {
            continue
        }

        var hostBuffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
            address,
            socklen_t(address.pointee.sa_len),
            &hostBuffer,
            socklen_t(hostBuffer.count),
            nil,
            0,
            NI_NUMERICHOST
        )
        guard result == 0 else {
            continue
        }
        let host = String(cString: hostBuffer)
        if !host.isEmpty {
            return host
        }
    }
    return nil
}