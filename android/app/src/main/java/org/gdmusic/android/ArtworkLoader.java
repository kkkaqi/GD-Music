package org.gdmusic.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.Consumer;

final class ArtworkLoader implements AutoCloseable {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final LruCache<String, Bitmap> cache = new LruCache<>(12);

    Future<?> load(Context context, MusicApi.Track track, Consumer<Bitmap> loaded) {
        return worker.submit(() -> {
            String key = track.source().id + ":" + track.coverId();
            Bitmap art = cache.get(key);
            if (art == null) {
                try {
                    var url = MusicApi.INSTANCE.coverUrl(context, track);
                    if (url != null) art = download(url.toURL().openConnection());
                    if (art != null) cache.put(key, art);
                } catch (IOException ignored) {
                    // Keep the placeholder when the artwork endpoint is unavailable.
                }
            }
            Bitmap image = art;
            if (!Thread.currentThread().isInterrupted() && image != null) main.post(() -> loaded.accept(image));
        });
    }

    private Bitmap download(java.net.URLConnection request) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) request;
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(8_000);
        connection.setRequestProperty("Referer", WebsiteApi.ORIGIN + "/");
        try (var input = connection.getInputStream(); var output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            for (int count; (count = input.read(buffer)) != -1; ) {
                if (output.size() + count > 2 * 1024 * 1024 || Thread.currentThread().isInterrupted()) return null;
                output.write(buffer, 0, count);
            }
            byte[] bytes = output.toByteArray();
            var options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (options.outWidth <= 0 || options.outHeight <= 0) return null;
            options.inJustDecodeBounds = false;
            options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 512) {
                options.inSampleSize *= 2;
            }
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } finally {
            connection.disconnect();
        }
    }

    @Override public void close() {
        worker.shutdownNow();
    }
}
