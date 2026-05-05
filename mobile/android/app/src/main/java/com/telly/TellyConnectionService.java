// TellyConnectionService.java
// Android ConnectionService implementation for Telly VoIP.
// Allows Telly to ring even if the app is 100% closed and integrates
// with Android's native call UI and recents list.

package com.telly;

import android.net.Uri;
import android.os.Bundle;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;

public class TellyConnectionService extends ConnectionService {

    @Override
    public Connection onCreateIncomingConnection(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {

        TellyConnection connection = new TellyConnection();
        connection.setAddress(request.getAddress(), TelecomManager.PRESENTATION_ALLOWED);
        connection.setVideoState(request.getVideoState());
        connection.setRinging();

        Bundle extras = request.getExtras();
        if (extras != null) {
            String callId = extras.getString("callId");
            String callerId = extras.getString("callerId");
            connection.putExtras(extras);
            TellyCallManager.getInstance().registerConnection(callId, connection);
        }

        return connection;
    }

    @Override
    public Connection onCreateOutgoingConnection(
            PhoneAccountHandle connectionManagerPhoneAccount,
            ConnectionRequest request) {

        TellyConnection connection = new TellyConnection();
        connection.setAddress(request.getAddress(), TelecomManager.PRESENTATION_ALLOWED);
        connection.setVideoState(request.getVideoState());
        connection.setDialing();

        Bundle extras = request.getExtras();
        if (extras != null) {
            String callId = extras.getString("callId");
            connection.putExtras(extras);
            TellyCallManager.getInstance().registerConnection(callId, connection);
        }

        return connection;
    }
}
