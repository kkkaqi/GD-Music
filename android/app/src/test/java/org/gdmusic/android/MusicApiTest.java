package org.gdmusic.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.List;
import org.junit.Test;

public class MusicApiTest {
    @Test
    public void searchUsesPlaybackIdAndSkipsIncompleteResults() throws Exception {
        List<MusicApi.Track> tracks = MusicApi.parseTracks(MusicSource.EMBEAT, """
                [{"id":"10","url_id":"20","name":"歌名","artist":["甲","乙"],"source":"embeat","pic_id":"30"},
                 {"id":30,"url_id":"","name":"另一个版本","source":"netease","artist":"丙"},
                 {"name":"缺少编号"},{"id":"40","name":""}]
                """);
        assertEquals(2, tracks.size());
        assertEquals("20", tracks.get(0).playbackId());
        assertEquals("10", tracks.get(0).id());
        assertEquals("30", tracks.get(0).coverId());
        assertEquals(MusicSource.EMBEAT, tracks.get(0).source());
        assertEquals("甲 / 乙", tracks.get(0).artist());
        assertEquals("30", tracks.get(1).playbackId());
        assertEquals(MusicSource.NETEASE, tracks.get(1).source());
        assertEquals("丙", tracks.get(1).artist());
        assertEquals("", tracks.get(1).coverId());
    }

    @Test
    public void audioUrlsRequireHttpOrHttpsAndPreferSecureNeteaseCdn() throws Exception {
        assertEquals("https://m801.music.126.net/song.mp3",
                MusicApi.parseAudioUrl("{\"url\":\"http://m801.music.126.net/song.mp3\"}"));
        assertEquals("https://example.org/song.mp3",
                MusicApi.parseAudioUrl("{\"url\":\"https://example.org/song.mp3\"}"));
        assertEquals("https://music.gdstudio.org/media/song.mp3",
                MusicApi.parseAudioUrl("{\"url\":\"/media/song.mp3\"}"));
        assertThrows(IOException.class, () -> MusicApi.parseAudioUrl("{\"url\":\"\"}"));
        assertThrows(IOException.class, () -> MusicApi.parseAudioUrl("{\"url\":\"file:///sdcard/a.mp3\"}"));
        assertThrows(IOException.class, () -> MusicApi.parseAudioUrl("{\"url\":\"http://example.org/a.mp3\"}"));
    }
}
