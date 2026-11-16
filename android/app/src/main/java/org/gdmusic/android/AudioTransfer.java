package org.gdmusic.android;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

final class AudioTransfer {
    private static final Pattern FULL_RANGE = Pattern.compile("bytes 0-(\\d+)/(\\d+)", Pattern.CASE_INSENSITIVE);

    static final class HttpError extends IOException {
        final int status;

        HttpError(int status) {
            super("音源返回 HTTP " + status);
            this.status = status;
        }

        boolean refreshAddress() { return status == 403 || status == 410; }
    }

    static void copy(HttpURLConnection connection, OutputStream output, BooleanSupplier stopped) throws IOException {
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(25_000);
        connection.setRequestProperty("Referer", WebsiteApi.ORIGIN + "/");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Range", "bytes=0-");
        try {
            int status = connection.getResponseCode();
            if (status != 200 && status != 206) throw new HttpError(status);
            String mime = connection.getContentType();
            if (mime != null) {
                mime = mime.toLowerCase(Locale.ROOT);
                if (mime.startsWith("text/") || mime.startsWith("multipart/") ||
                        mime.contains("json") || mime.contains("mpegurl")) {
                    throw new IOException("音源未返回音频文件");
                }
            }
            long expected = connection.getContentLengthLong();
            if (status == 206) {
                long total = completeRangeLength(connection.getHeaderField("Content-Range"));
                if (expected >= 0 && expected != total) throw new IOException("音频内容长度不一致");
                expected = total;
            }
            long bytes = 0;
            try (var input = connection.getInputStream()) {
                byte[] buffer = new byte[64 * 1024];
                for (int count; (count = input.read(buffer)) != -1; ) {
                    if (stopped.getAsBoolean()) throw new InterruptedIOException("下载已取消");
                    bytes += count;
                    if (expected >= 0 && bytes > expected) throw new IOException("音频内容长度不一致");
                    output.write(buffer, 0, count);
                }
            }
            if (bytes == 0 || (expected >= 0 && bytes != expected)) throw new IOException("音频文件不完整");
        } finally {
            connection.disconnect();
        }
    }

    private static long completeRangeLength(String range) throws IOException {
        if (range != null) {
            var match = FULL_RANGE.matcher(range.trim());
            if (match.matches()) {
                try {
                    long end = Long.parseLong(match.group(1));
                    long total = Long.parseLong(match.group(2));
                    if (total > 0 && end == total - 1) return total;
                } catch (NumberFormatException error) {
                    throw new IOException("音频范围无效", error);
                }
            }
        }
        throw new IOException("音源未返回完整音频");
    }
}
