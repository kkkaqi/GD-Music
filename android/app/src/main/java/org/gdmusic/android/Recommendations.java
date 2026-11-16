package org.gdmusic.android;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

final class Recommendations {
    static final List<MusicApi.Track> PICKS = Collections.unmodifiableList(Arrays.asList(
            song("28815250", "平凡之路", "朴树", "18885211718782327"),
            song("449818741", "光年之外", "G.E.M.邓紫棋", "18587244069235039"),
            song("25706282", "夜空中最亮的星", "逃跑计划", "109951168111472442"),
            song("254574", "后来", "刘若英", "109951163351825356"),
            song("1330348068", "起风了", "买辣椒也用券", "109951163699673355"),
            song("35847388", "Hello", "Adele", "109951168981824640")
    ));

    private static MusicApi.Track song(String id, String title, String artist, String coverId) {
        return new MusicApi.Track(MusicSource.NETEASE, id, id, id, title, artist, coverId);
    }
}
