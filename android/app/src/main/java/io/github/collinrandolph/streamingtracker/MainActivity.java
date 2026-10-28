package io.github.collinrandolph.streamingtracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RokuFindPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
