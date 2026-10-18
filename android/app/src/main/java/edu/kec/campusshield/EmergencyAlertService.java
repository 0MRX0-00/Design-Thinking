package edu.kec.campusshield;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

/**
 * CampusShield Persistent Background Emergency Alert Service
 * Keeps emergency monitoring active even after the user terminates or swipes away the app.
 * Plays loud acoustic siren/beeps and fires heads-up notifications on distress SOS events.
 */
public class EmergencyAlertService extends Service {

    private static final String TAG = "CampusShieldService";
    private static final String SERVICE_CHANNEL_ID = "campusshield_service_channel";
    public static final String EMERGENCY_CHANNEL_ID = "campusshield_emergency";
    private static final int SERVICE_NOTIFICATION_ID = 9001;

    public static final String PREFS_NAME = "CampusShieldPrefs";
    public static final String KEY_BACKEND_URL = "backend_url";
    public static final String DEFAULT_BACKEND_URL = "https://design-thinking-7ne9.onrender.com";

    private volatile boolean isRunning = false;
    private Thread workerThread;
    private long lastCheckedTimestamp = 0;
    private final Set<String> notifiedIncidents = new HashSet<>();

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "EmergencyAlertService created.");
        createNotificationChannels();

        Notification notification = createForegroundNotification();
        try {
            startForeground(SERVICE_NOTIFICATION_ID, notification);
        } catch (Exception e) {
            Log.w(TAG, "startForeground error: " + e.getMessage());
        }

        lastCheckedTimestamp = System.currentTimeMillis() - 30000; // Check last 30 seconds initially
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "EmergencyAlertService onStartCommand called.");

        if (intent != null && intent.hasExtra(KEY_BACKEND_URL)) {
            String url = intent.getStringExtra(KEY_BACKEND_URL);
            if (url != null && !url.trim().isEmpty()) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(KEY_BACKEND_URL, url.trim()).apply();
            }
        }

        if (!isRunning) {
            isRunning = true;
            startMonitoringLoop();
        }

        return START_STICKY;
    }

    private void startMonitoringLoop() {
        workerThread = new Thread(() -> {
            Log.i(TAG, "Emergency monitoring background thread started.");
            while (isRunning) {
                try {
                    checkForEmergencies();
                } catch (Exception e) {
                    Log.w(TAG, "Poll iteration exception: " + e.getMessage());
                }

                try {
                    // Check every 4 seconds for immediate emergency notification response
                    Thread.sleep(4000);
                } catch (InterruptedException e) {
                    break;
                }
            }
            Log.i(TAG, "Emergency monitoring background thread stopped.");
        });
        workerThread.start();
    }

    private void checkForEmergencies() {
        String baseUrl = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL);

        if (baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }

        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl + "/api/incidents/emergency-check?since=" + lastCheckedTimestamp);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setRequestProperty("Accept", "application/json");

            int responseCode = conn.getResponseCode();
            if (responseCode == 200) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();

                JSONObject response = new JSONObject(sb.toString());
                if (response.optBoolean("success", false)) {
                    long serverTimestamp = response.optLong("timestamp", System.currentTimeMillis());
                    JSONArray incidents = response.optJSONArray("incidents");

                    if (incidents != null && incidents.length() > 0) {
                        for (int i = 0; i < incidents.length(); i++) {
                            JSONObject inc = incidents.getJSONObject(i);
                            String incId = inc.optString("incidentId", "");
                            if (!incId.isEmpty() && !notifiedIncidents.contains(incId)) {
                                notifiedIncidents.add(incId);
                                triggerEmergencyAlertNotification(inc);
                            }
                        }
                    }
                    lastCheckedTimestamp = serverTimestamp;
                }
            }
        } catch (Exception e) {
            // Network hiccups are normal in mobile environments; suppressed for clean logging
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void triggerEmergencyAlertNotification(JSONObject inc) {
        String incidentId = inc.optString("incidentId", "EMERGENCY");
        String category = inc.optString("category", "SOS Distress Alert");
        String severity = inc.optString("severity", "CRITICAL");
        JSONObject locationObj = inc.optJSONObject("location");
        String campusLoc = locationObj != null ? locationObj.optString("campusLocation", "Campus Ground") : "Campus Ground";
        String description = inc.optString("description", "Immediate security assistance requested.");

        Log.e(TAG, "🚨 CRITICAL INCIDENT DETECTED: [" + incidentId + "] " + category + " at " + campusLoc);

        // 1. Wake up device screen and CPU
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            PowerManager.WakeLock wakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                    "CampusShield:EmergencyAlertWakeLock"
            );
            wakeLock.acquire(10000); // Hold for 10 seconds to show alert
        }

        // 2. Play Emergency Loud Beep / Siren Sound
        playEmergencySound();

        // 3. Post High-Priority Heads-Up Notification
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                (int) System.currentTimeMillis(),
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, EMERGENCY_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("🚨 CRITICAL EMERGENCY: " + category.toUpperCase())
                .setContentText("Location: " + campusLoc + " • " + incidentId)
                .setStyle(new NotificationCompat.BigTextStyle()
                        .bigText("🚨 " + category.toUpperCase() + " reported at " + campusLoc + "!\n\n" + description + "\n\nTap to open Command Center."))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setFullScreenIntent(pendingIntent, true)
                .setContentIntent(pendingIntent)
                .setColor(Color.RED)
                .setLights(Color.RED, 500, 200)
                .setVibrate(new long[]{0, 500, 200, 500, 200, 1000});

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) System.currentTimeMillis(), builder.build());
        }
    }

    private void playEmergencySound() {
        try {
            // Play Alarm / Emergency Tone
            ToneGenerator toneGen = new ToneGenerator(AudioManager.STREAM_ALARM, 100);
            toneGen.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 2000);

            // Also play loud system alarm / notification ringtone
            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            if (soundUri != null) {
                Ringtone ringtone = RingtoneManager.getRingtone(getApplicationContext(), soundUri);
                if (ringtone != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        AudioAttributes attrs = new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build();
                        ringtone.setAudioAttributes(attrs);
                    }
                    ringtone.play();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Audio tone generation error: " + e.getMessage());
        }
    }

    private Notification createForegroundNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, openIntent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
                .setContentTitle("CampusShield Safety Active")
                .setContentText("Emergency monitoring online • Immediate distress alerts enabled")
                .setSmallIcon(android.R.drawable.ic_lock_idle_charging)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setContentIntent(pendingIntent)
                .build();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // 1. Silent Ongoing Service Channel
            NotificationChannel serviceChannel = new NotificationChannel(
                    SERVICE_CHANNEL_ID,
                    "CampusShield Background Service",
                    NotificationManager.IMPORTANCE_MIN
            );
            serviceChannel.setDescription("Keeps emergency dispatch and push alerts alive in background.");
            serviceChannel.setShowBadge(false);
            nm.createNotificationChannel(serviceChannel);

            // 2. High-Priority Emergency Distress Siren Channel
            NotificationChannel emergencyChannel = new NotificationChannel(
                    EMERGENCY_CHANNEL_ID,
                    "CampusShield Emergency Sirens",
                    NotificationManager.IMPORTANCE_HIGH
            );
            emergencyChannel.setDescription("Critical SOS alarms, heads-up popups, and audible siren alerts.");
            emergencyChannel.enableLights(true);
            emergencyChannel.setLightColor(Color.RED);
            emergencyChannel.enableVibration(true);
            emergencyChannel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 1000});
            emergencyChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmSound == null) {
                alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .build();
            emergencyChannel.setSound(alarmSound, audioAttributes);

            nm.createNotificationChannel(emergencyChannel);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Triggered when user swipes away app from Recent Apps / terminates UI
        Log.i(TAG, "Application UI was terminated by user. Rescheduling service via AlarmManager...");

        Intent restartIntent = new Intent(getApplicationContext(), EmergencyAlertService.class);
        restartIntent.setPackage(getPackageName());
        PendingIntent restartPendingIntent = PendingIntent.getService(
                getApplicationContext(),
                101,
                restartIntent,
                PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
        );

        AlarmManager alarmManager = (AlarmManager) getApplicationContext().getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null) {
            alarmManager.set(
                    AlarmManager.ELAPSED_REALTIME,
                    SystemClock.elapsedRealtime() + 1500,
                    restartPendingIntent
            );
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (workerThread != null) {
            workerThread.interrupt();
        }
        Log.i(TAG, "EmergencyAlertService destroyed.");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
