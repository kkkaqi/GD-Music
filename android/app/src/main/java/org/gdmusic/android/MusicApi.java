package org.gdmusic.android;

import android.content.Context;
import android.icu.text.Transliterator;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

final class MusicApi {
    static final MusicApi INSTANCE = new MusicApi();
    private static final String API = "https://music-api.gdstudio.xyz/api.php";
    private static final long RATE_WINDOW = 5 * 60_000L;
    private record Cached(String body, long expiresAt) {}
    record Track(MusicSource source, String id, String playbackId, String lyricId, String title, String artist,
                 String coverId) {}
    static final class NoAudio extends IOException {
        NoAudio() { super("这首歌暂时没有可用的播放地址"); }
    }

    private static final class Site {
        static final WebsiteApi CLIENT = new WebsiteApi();
    }
    private final Map<String, Cached> cache = new LinkedHashMap<>();
    private final ArrayDeque<Long> requests = new ArrayDeque<>();
    private long blockedUntil;

    List<Track> search(Context context, MusicSource source, String name) throws IOException {
        return search(context, source, name, 20);
    }

    private List<Track> search(Context context, MusicSource source, String name, int count) throws IOException {
        String query = "types=search&source=" + source.id + "&count=" + count + "&pages=1&name=" + encode(name);
        return parseTracks(source, request(context, source, query, name, RATE_WINDOW));
    }

    Track findKuwoMatch(Context context, Track original) throws IOException {
        return findMatch(context, original, MusicSource.KUWO, 20);
    }

    Track findMatch(Context context, Track original, MusicSource source, int count) throws IOException {
        if (original.artist().trim().isEmpty()) return null;
        UnaryOperator<String> simplify = Build.VERSION.SDK_INT >= 29
                ? Transliterator.getInstance("Traditional-Simplified")::transliterate : UnaryOperator.identity();
        String title = Normalizer.normalize(original.title(), Normalizer.Form.NFKC);
        int qualifier = title.indexOf('(');
        String name = qualifier > 0 ? title.substring(0, qualifier).trim() : title;
        String query = simplify.apply(name + " " + original.artist().split(" / ", 2)[0]);
        List<Track> candidates = search(context, source, query, count);
        return TrackMatch.find(original, candidates.subList(0, Math.min(count, candidates.size())), source, simplify);
    }

    String audioUrl(Context context, MusicSource source, String id, String originalId, Quality quality) throws IOException {
        try {
            return resolveAudio(context, source, id, quality);
        } catch (NoAudio error) {
            if (originalId == null || originalId.equals(id)) throw error;
            return resolveAudio(context, source, originalId, quality);
        }
    }

    List<Lyrics.Line> lyrics(Context context, Track track) throws IOException {
        String query = "types=lyric&source=" + track.source.id + "&id=" + encode(track.lyricId);
        String response = request(context, track.source, query, track.lyricId, 6 * RATE_WINDOW);
        try {
            JSONObject data = new JSONObject(response);
            return Lyrics.parse(data.optString("lyric", ""), data.optString("tlyric", ""));
        } catch (JSONException error) {
            throw new IOException("歌词读取失败", error);
        }
    }

    URI coverUrl(Context context, Track track) throws IOException {
        if (track.coverId.isEmpty()) return null;
        String query = "types=pic&source=" + track.source.id + "&id=" + encode(track.coverId) + "&size=500";
        try {
            String raw = new JSONObject(request(context, track.source, query, track.coverId, 6 * RATE_WINDOW))
                    .optString("url", "").trim();
            if (raw.isEmpty()) return null;
            URI url = URI.create(WebsiteApi.ORIGIN + "/").resolve(raw);
            return "https".equals(url.getScheme()) && url.getHost() != null && url.getUserInfo() == null ? url : null;
        } catch (JSONException | IllegalArgumentException error) {
            return null;
        }
    }

    private String resolveAudio(Context context, MusicSource source, String id, Quality quality) throws IOException {
        String query = audioQuery(source, id, quality);
        try {
            return parseAudioUrl(request(context, source, query, id, 10 * 60_000L));
        } catch (IOException error) {
            invalidateAudio(source, id, quality);
            throw error;
        }
    }

    synchronized void invalidateAudio(MusicSource source, String id, Quality quality) {
        cache.remove(audioQuery(source, id, quality));
    }

    private static String audioQuery(MusicSource source, String id, Quality quality) {
        return "types=url&source=" + source.id + "&br=" + quality.code + "&id=" + encode(id);
    }

    static List<Track> parseTracks(MusicSource source, String body) throws IOException {
        try {
            JSONArray rows = new JSONArray(body);
            List<Track> tracks = new ArrayList<>();
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String id = row.optString("id", "").trim();
                String playbackId = row.optString("url_id", "").trim();
                String title = row.optString("name", "").trim();
                if (id.isEmpty()) id = playbackId;
                if (id.isEmpty() || title.isEmpty()) continue;
                if (playbackId.isEmpty()) playbackId = id;
                String lyricId = row.optString("lyric_id", "").trim();
                if (lyricId.isEmpty()) lyricId = id;
                List<String> artists = new ArrayList<>();
                JSONArray names = row.optJSONArray("artist");
                for (int j = 0; names != null && j < names.length(); j++) {
                    String name = names.optString(j, "").trim();
                    if (!name.isEmpty()) artists.add(name);
                }
                String artist = names == null ? row.optString("artist", "").trim() : String.join(" / ", artists);
                tracks.add(new Track(MusicSource.fromId(row.optString("source"), source), id, playbackId, lyricId,
                        title, artist, row.optString("pic_id", "").trim()));
            }
            return tracks;
        } catch (JSONException error) {
            throw new IOException("搜索结果读取失败，请稍后重试", error);
        }
    }

    static String parseAudioUrl(String body) throws IOException {
        try {
            JSONObject response = new JSONObject(body);
            String url = response.optString("url", "").trim();
            if (url.isEmpty() || response.optDouble("br", 0) < 0) throw new NoAudio();
            if (url.startsWith("/")) url = URI.create(WebsiteApi.ORIGIN + "/").resolve(url).toString();
            URI uri = URI.create(url);
            String host = uri.getHost();
            if (host != null && uri.getUserInfo() == null) {
                if ("music-proxy.gdstudio.org".equalsIgnoreCase(host) && "/".equals(uri.getPath())) throw new NoAudio();
                if ("https".equalsIgnoreCase(uri.getScheme())) return url;
                if ("http".equalsIgnoreCase(uri.getScheme()) && host.toLowerCase(java.util.Locale.ROOT).endsWith(".music.126.net")) {
                    return "https:" + url.substring(url.indexOf(':') + 1);
                }
            }
        } catch (JSONException | IllegalArgumentException error) {
            throw new IOException("播放地址读取失败", error);
        }
        throw new NoAudio();
    }

    private String request(Context context, MusicSource source, String query, String value, long ttl) throws IOException {
        synchronized (this) {
            long now = android.os.SystemClock.elapsedRealtime();
            Cached hit = cache.get(query);
            if (hit != null && hit.expiresAt() > now) return hit.body();
            while (!requests.isEmpty() && requests.peekFirst() <= now - RATE_WINDOW) requests.removeFirst();
            if (now < blockedUntil || requests.size() >= 48) {
                throw new IOException("音源请求过于频繁，请稍后重试");
            }
            requests.addLast(now);
        }
        WebsiteApi.Response response = source == MusicSource.NETEASE
                ? requestPublicApi(query) : Site.CLIENT.request(context, query, value);
        int status = response.status();
        if (status == 429) {
            synchronized (this) {
                blockedUntil = android.os.SystemClock.elapsedRealtime() + RATE_WINDOW;
            }
            throw new IOException("音源暂时限流，请稍后重试");
        }
        if (status != 200) throw new IOException("音源暂不可用（" + status + "）");
        String body = response.body();
        synchronized (this) {
            if (cache.size() >= 100) cache.remove(cache.keySet().iterator().next());
            cache.put(query, new Cached(body, android.os.SystemClock.elapsedRealtime() + ttl));
        }
        return body;
    }

    private WebsiteApi.Response requestPublicApi(String query) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) URI.create(API + "?" + query).toURL().openConnection();
        connection.setConnectTimeout(12_000);
        connection.setReadTimeout(12_000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status != 200) return new WebsiteApi.Response(status, "");
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                for (int count; (count = input.read(buffer)) != -1; ) {
                    if (bytes.size() + count > 512 * 1024) throw new IOException("音源返回的数据过大");
                    bytes.write(buffer, 0, count);
                }
                return new WebsiteApi.Response(status, new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (java.io.UnsupportedEncodingException error) {
            throw new AssertionError(error);
        }
    }
}
