package org.gdmusic.android;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.function.UnaryOperator;

final class TrackMatch {
    static MusicApi.Track find(MusicApi.Track original, List<MusicApi.Track> candidates, MusicSource source,
                               UnaryOperator<String> simplify) {
        String title = normalize(original.title(), simplify);
        var artists = new HashSet<String>();
        for (String artist : original.artist().split(" / ")) {
            String normalized = normalize(artist, simplify);
            if (!normalized.isEmpty()) artists.add(normalized);
        }
        if (title.isEmpty() || artists.isEmpty()) return null;
        for (MusicApi.Track track : candidates) {
            if (track.source() != source || !title.equals(normalize(track.title(), simplify))) continue;
            for (String artist : track.artist().split(" / ")) {
                if (artists.contains(normalize(artist, simplify))) return track;
            }
        }
        return null;
    }

    private static String normalize(String text, UnaryOperator<String> simplify) {
        return simplify.apply(Normalizer.normalize(text, Normalizer.Form.NFKC))
                .trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }
}
