// TellyCallKit.swift
// CallKit integration for iOS – allows Telly to use the native iOS call UI,
// appear in recents, and ring even when the app is in the background.

import Foundation
import CallKit
import AVFoundation

class TellyCallKit: NSObject {

    static let shared = TellyCallKit()

    private let provider: CXProvider
    private let callController = CXCallController()
    private var activeCalls: [UUID: String] = [:] // UUID -> callId

    private override init() {
        let config = CXProviderConfiguration()
        config.localizedName = "Telly"
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.phoneNumber, .generic]
        config.iconTemplateImageData = nil // Set app icon data in production
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    // Report an incoming call to iOS – rings even if app is closed
    func reportIncomingCall(callId: String, callerName: String, callerHandle: String) {
        let uuid = UUID()
        activeCalls[uuid] = callId

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerHandle)
        update.localizedCallerName = callerName
        update.hasVideo = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false

        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[TellyCallKit] Failed to report incoming call: \(error)")
            }
        }
    }

    // Start an outgoing call
    func startOutgoingCall(callId: String, handle remoteHandle: String) {
        let uuid = UUID()
        activeCalls[uuid] = callId

        let cxHandle = CXHandle(type: .generic, value: remoteHandle)
        let action = CXStartCallAction(call: uuid, handle: cxHandle)
        action.isVideo = false

        let transaction = CXTransaction(action: action)
        callController.request(transaction) { error in
            if let error = error {
                print("[TellyCallKit] Failed to start outgoing call: \(error)")
            }
        }
    }

    // End a call by callId
    func endCall(callId: String) {
        guard let uuid = activeCalls.first(where: { $0.value == callId })?.key else { return }
        let action = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: action)
        callController.request(transaction) { _ in }
        activeCalls.removeValue(forKey: uuid)
    }
}

// MARK: - CXProviderDelegate
extension TellyCallKit: CXProviderDelegate {

    func providerDidReset(_ provider: CXProvider) {
        activeCalls.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let callId = activeCalls[action.callUUID] else {
            action.fail()
            return
        }
        // Notify React Native bridge that call was answered
        NotificationCenter.default.post(name: .tellyCallAnswered, object: callId)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard let callId = activeCalls[action.callUUID] else {
            action.fail()
            return
        }
        NotificationCenter.default.post(name: .tellyCallEnded, object: callId)
        activeCalls.removeValue(forKey: action.callUUID)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Configure audio session for VoIP
        try? audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        try? audioSession.setActive(true)
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        try? audioSession.setActive(false)
    }
}

extension Notification.Name {
    static let tellyCallAnswered = Notification.Name("TellyCallAnswered")
    static let tellyCallEnded = Notification.Name("TellyCallEnded")
}
