// AppDelegate.swift
// iOS app delegate with VoIP push notification registration for background call wake-up.

import UIKit
import PushKit
import CallKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate {

    var window: UIWindow?
    private var voipRegistry: PKPushRegistry?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Register for VoIP push notifications – wakes app even in background/killed state
        voipRegistry = PKPushRegistry(queue: .main)
        voipRegistry?.delegate = self
        voipRegistry?.desiredPushTypes = [.voIP]

        return true
    }

    // MARK: - PKPushRegistryDelegate

    func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        print("[Telly] VoIP push token: \(token)")
        // TODO: Send token to Telly backend for FCM/APNs registration
    }

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP,
              let callId = payload.dictionaryPayload["callId"] as? String,
              let callerName = payload.dictionaryPayload["callerName"] as? String,
              let callerHandle = payload.dictionaryPayload["callerHandle"] as? String else {
            completion()
            return
        }

        // Must report incoming call to CallKit before calling completion()
        TellyCallKit.shared.reportIncomingCall(
            callId: callId,
            callerName: callerName,
            callerHandle: callerHandle
        )
        completion()
    }
}
