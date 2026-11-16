package org.gdmusic.android;

import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import java.util.List;
import java.util.function.UnaryOperator;
import org.junit.Test;

public class TrackMatchTest {
    @Test public void findsSameSongDespiteTraditionalCharactersAndSpacing() {
        var original = track(MusicSource.YTMUSIC, "晴天", "周杰倫");
        var target = track(MusicSource.KUWO, " 晴天 ", "周杰伦");
        assertSame(target, TrackMatch.find(original, List.of(target), MusicSource.KUWO,
                text -> text.replace('倫', '伦')));
    }

    @Test public void skipsLiveVersionsAndCoversByOtherArtists() {
        var original = track(MusicSource.YTMUSIC, "晴天", "周杰倫");
        assertNull(TrackMatch.find(original, List.of(
                track(MusicSource.KUWO, "晴天 (Live)", "周杰倫"),
                track(MusicSource.KUWO, "晴天", "另一个歌手")), MusicSource.KUWO, UnaryOperator.identity()));
    }

    @Test public void matchesFullWidthParenthesesInTheOriginalTitle() {
        var original = track(MusicSource.YTMUSIC, "烟火里的尘埃（我的心里住着一个苍老的小孩）", "李雨婷");
        var target = track(MusicSource.KUWO, "烟火里的尘埃(我的心里住着一个苍老的小孩)", "李雨婷");
        assertSame(target, TrackMatch.find(original, List.of(target), MusicSource.KUWO, UnaryOperator.identity()));
    }

    @Test public void findsYouTubeRecordingWithASharedArtistAndSkipsAnotherSource() {
        var original = track(MusicSource.NETEASE, "晴天", "周杰伦");
        var otherSource = track(MusicSource.KUWO, "晴天", "周杰伦");
        var target = track(MusicSource.YTMUSIC, "晴天", "周杰伦 / 合作歌手");
        assertSame(target, TrackMatch.find(original, List.of(otherSource, target),
                MusicSource.YTMUSIC, UnaryOperator.identity()));
    }

    private static MusicApi.Track track(MusicSource source, String title, String artist) {
        return new MusicApi.Track(source, "123", "123", "123", title, artist, "");
    }
}
