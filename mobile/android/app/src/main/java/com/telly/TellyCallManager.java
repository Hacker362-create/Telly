// TellyCallManager.java
// Singleton manager that bridges between TellyConnectionService and the React Native layer.

package com.telly;

import java.util.HashMap;
import java.util.Map;

public class TellyCallManager {

    private static TellyCallManager instance;
    private final Map<String, TellyConnection> activeConnections = new HashMap<>();

    private TellyCallManager() {}

    public static synchronized TellyCallManager getInstance() {
        if (instance == null) {
            instance = new TellyCallManager();
        }
        return instance;
    }

    public void registerConnection(String callId, TellyConnection connection) {
        if (callId != null) {
            activeConnections.put(callId, connection);
        }
    }

    public void answerCall(String callId) {
        TellyConnection conn = activeConnections.get(callId);
        if (conn != null) {
            conn.setActive();
        }
    }

    public void endCall(String callId) {
        TellyConnection conn = activeConnections.get(callId);
        if (conn != null) {
            conn.onDisconnect();
            activeConnections.remove(callId);
        }
    }

    public void onCallAnswered(String address) {
        // Notify React Native layer via event emitter
    }

    public void onCallRejected(String address) {
        // Notify React Native layer via event emitter
    }

    public void onCallEnded(String address) {
        // Notify React Native layer via event emitter
    }
}
