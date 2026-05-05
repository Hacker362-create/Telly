// TellyConnection.java
// Represents a single Telly VoIP call within Android's ConnectionService framework.
// Enables Telly to appear as a native call in Android's system UI and recents.

package com.telly;

import android.telecom.Connection;
import android.telecom.DisconnectCause;

public class TellyConnection extends Connection {

    public TellyConnection() {
        setAudioModeIsVoip(true);
        setConnectionProperties(PROPERTY_SELF_MANAGED);
    }

    @Override
    public void onAnswer() {
        setActive();
        TellyCallManager.getInstance().onCallAnswered(getAddress().toString());
    }

    @Override
    public void onReject() {
        setDisconnected(new DisconnectCause(DisconnectCause.REJECTED));
        destroy();
        TellyCallManager.getInstance().onCallRejected(getAddress().toString());
    }

    @Override
    public void onDisconnect() {
        setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
        destroy();
        TellyCallManager.getInstance().onCallEnded(getAddress().toString());
    }

    @Override
    public void onHold() {
        setOnHold();
    }

    @Override
    public void onUnhold() {
        setActive();
    }
}
