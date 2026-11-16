package org.gdmusic.android;

enum MusicSource {
    NETEASE("netease", "网易云"),
    TENCENT("tencent", "QQ 音乐"),
    KUWO("kuwo", "酷我"),
    TIDAL("tidal", "TIDAL"),
    QOBUZ("qobuz", "Qobuz"),
    JOOX("joox", "JOOX"),
    BILIBILI("bilibili", "哔哩哔哩"),
    APPLE("apple", "Apple Music"),
    YTMUSIC("ytmusic", "YouTube Music"),
    EMBEAT("embeat", "Embeat");

    final String id;
    final String label;

    MusicSource(String id, String label) {
        this.id = id;
        this.label = label;
    }

    static MusicSource fromId(String id, MusicSource fallback) {
        for (MusicSource source : values()) {
            if (source.id.equals(id)) return source;
        }
        return fallback;
    }
}
