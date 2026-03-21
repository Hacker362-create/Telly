package com.telly;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public class TellyFirebaseMessagingService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
