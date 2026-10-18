package edu.kec.campusshield;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Ensure Android WebView preserves LocalStorage and database across app restarts
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
        }

        // Start Persistent Background Emergency Monitoring Service
        startEmergencyService();
    }

    private void startEmergencyService() {
        try {
            Intent serviceIntent = new Intent(this, EmergencyAlertService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            android.util.Log.w("MainActivity", "Could not start EmergencyAlertService: " + e.getMessage());
        }
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            String currentUrl = webView.getUrl();
            if (currentUrl != null && (
                    currentUrl.contains("student.html") ||
                    currentUrl.contains("security.html") ||
                    currentUrl.contains("admin.html") ||
                    currentUrl.endsWith("/student") ||
                    currentUrl.endsWith("/security") ||
                    currentUrl.endsWith("/admin")
            )) {
                // If on main dashboard, pressing Android Back minimizes/backgrounds the app
                // instead of navigating back to the login screen
                moveTaskToBack(true);
                return;
            }
        }
        super.onBackPressed();
    }
}
