package edu.kec.campusshield;

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
