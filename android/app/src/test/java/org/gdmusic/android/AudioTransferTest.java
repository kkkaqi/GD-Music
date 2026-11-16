package org.gdmusic.android;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import org.junit.Test;

public class AudioTransferTest {
    private static final byte[] AUDIO = {1, 2, 3, 4};

    @Test public void savesCompletePartialResponse() throws IOException {
        assertArrayEquals(AUDIO, download(206, "bytes 0-3/4"));
    }

    @Test public void savesFullResponseFromServerWithoutRangeSupport() throws IOException {
        assertArrayEquals(AUDIO, download(200, null));
    }

    @Test public void rejectsIncompleteRange() {
        assertThrows(IOException.class, () -> download(206, "bytes 0-3/8"));
    }

    @Test public void rejectsTruncatedRange() {
        assertThrows(IOException.class, () -> download(206, "bytes 0-7/8"));
    }

    @Test public void reportsDeniedAudio() {
        var error = assertThrows(AudioTransfer.HttpError.class, () -> download(403, null));
        assertEquals(403, error.status);
    }

    private byte[] download(int status, String contentRange) throws IOException {
        var response = new HttpURLConnection(new URL("https://example.com/audio")) {
            @Override public int getResponseCode() { return status; }
            @Override public String getContentType() { return "audio/mpeg"; }
            @Override public long getContentLengthLong() { return AUDIO.length; }
            @Override public String getHeaderField(String name) {
                return "Content-Range".equals(name) ? contentRange : null;
            }
            @Override public ByteArrayInputStream getInputStream() { return new ByteArrayInputStream(AUDIO); }
            @Override public void connect() {}
            @Override public void disconnect() {}
            @Override public boolean usingProxy() { return false; }
        };
        var output = new ByteArrayOutputStream();
        AudioTransfer.copy(response, output, () -> false);
        assertEquals("bytes=0-", response.getRequestProperty("Range"));
        return output.toByteArray();
    }
}
