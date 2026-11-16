package org.gdmusic.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

final class FavoriteLibrary {
    static final String WORK_TAG = "favorite-audio";
    static final String SONG_TAG = "favorite:";
    record Entry(MusicApi.Track track, Quality quality, long added) {}

    static String key(MusicSource source, String id) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((source.id + ":" + id).getBytes(StandardCharsets.UTF_8));
            return android.util.Base64.encodeToString(digest,
                    android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP);
        } catch (NoSuchAlgorithmException error) {
            throw new AssertionError(error);
        }
    }

    static List<Entry> list(Context context) {
        List<Entry> entries = new ArrayList<>();
        for (String key : prefs(context).getAll().keySet()) {
            Entry entry = get(context, key);
            if (entry != null) entries.add(entry);
        }
        entries.sort(Comparator.comparingLong(Entry::added).reversed());
        return entries;
    }

    static Entry get(Context context, String key) {
        String data = prefs(context).getString(key, null);
        if (data == null) return null;
        try {
            JSONObject json = new JSONObject(data);
            MusicSource source = MusicSource.fromId(json.getString("source"), null);
            if (source == null) return null;
            String id = json.getString("id");
            var track = new MusicApi.Track(source, id, json.getString("playbackId"), json.optString("lyricId", id),
                    json.getString("title"), json.optString("artist"), json.optString("coverId"));
            return new Entry(track, Quality.fromCode(json.getString("quality")), json.getLong("added"));
        } catch (JSONException error) {
            return null;
        }
    }

    static void add(Context context, MusicApi.Track track, Quality quality) {
        String key = key(track.source(), track.id());
        try {
            JSONObject json = new JSONObject()
                    .put("source", track.source().id)
                    .put("id", track.id())
                    .put("playbackId", track.playbackId())
                    .put("lyricId", track.lyricId())
                    .put("title", track.title())
                    .put("artist", track.artist())
                    .put("coverId", track.coverId())
                    .put("quality", quality.code)
                    .put("added", System.currentTimeMillis());
            prefs(context).edit().putString(key, json.toString()).apply();
        } catch (JSONException error) {
            throw new IllegalStateException(error);
        }
        enqueue(context, track, quality);
    }

    static void remove(Context context, MusicApi.Track track) {
        String key = key(track.source(), track.id());
        prefs(context).edit().remove(key).apply();
        WorkManager.getInstance(context).cancelUniqueWork(SONG_TAG + key);
    }

    static void enqueue(Context context, MusicApi.Track track, Quality quality) {
        enqueue(context, track, quality, ExistingWorkPolicy.KEEP);
    }

    static void retry(Context context, MusicApi.Track track, Quality quality) {
        enqueue(context, track, quality, ExistingWorkPolicy.REPLACE);
    }

    private static void enqueue(Context context, MusicApi.Track track, Quality quality, ExistingWorkPolicy policy) {
        String key = key(track.source(), track.id());
        if (track.source() == MusicSource.EMBEAT || localFile(context, key, quality).length() > 0) return;
        var constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED);
        if (Build.VERSION.SDK_INT >= 28) {
            var network = new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build();
            constraints.setRequiredNetworkRequest(network, NetworkType.CONNECTED);
        }
        var request = new OneTimeWorkRequest.Builder(FavoriteDownload.class).setConstraints(constraints.build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 3, TimeUnit.MINUTES)
                .setInputData(new Data.Builder().putString("key", key).build())
                .addTag(WORK_TAG).addTag(SONG_TAG + key).build();
        WorkManager.getInstance(context).enqueueUniqueWork(SONG_TAG + key, policy, request);
    }

    static File localFile(Context context, String key, Quality quality) {
        return new File(new File(context.getFilesDir(), "liked-audio"), key + "-" + quality.code + ".audio");
    }

    static File anyLocalFile(Context context, String key, Quality quality) {
        File exact = localFile(context, key, quality);
        if (exact.length() > 0) return exact;
        Entry entry = get(context, key);
        if (entry != null) {
            File saved = localFile(context, key, entry.quality());
            if (saved.length() > 0) return saved;
        }
        return null;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("liked", Context.MODE_PRIVATE);
    }
}
