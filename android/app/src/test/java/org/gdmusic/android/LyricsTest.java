package org.gdmusic.android;

import static org.junit.Assert.assertEquals;
import java.util.List;
import org.junit.Test;

public class LyricsTest {
    @Test public void reordersAndAlignsTimedTranslations() {
        var lines = Lyrics.parse("[00:10.1][00:20]重复\n[00:01.250]开头", "[00:01.250]intro");
        assertEquals(List.of(1250L, 10100L, 20000L), lines.stream().map(Lyrics.Line::at).toList());
        assertEquals("开头\nintro", lines.get(0).text());
        assertEquals(-1, Lyrics.active(lines, 0));
        assertEquals(1, Lyrics.active(lines, 11000));
    }

    @Test public void keepsPlainLyricsAndTranslationOnly() {
        assertEquals("第二句", Lyrics.parse("[ar:artist]\n第一句\n第二句", "").get(1).text());
        assertEquals("一行", Lyrics.parse("", "[00:03.00]一行").get(0).text());
    }
}
