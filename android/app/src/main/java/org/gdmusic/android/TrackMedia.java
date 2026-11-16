package org.gdmusic.android;

import android.net.Uri;
import android.os.Bundle;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;

final class TrackMedia {
    static Quality quality(MediaItem item, Quality fallback) {
        if (item == null) return fallback;
        String code = Uri.parse(item.mediaId).getQueryParameter("br");
        return code == null ? fallback : Quality.fromCode(code);
    }

    static MediaItem create(MusicApi.Track track, Quality quality, boolean preferLocal) {
        var uri = new Uri.Builder().scheme("gdtrack").authority(track.source().id)
                .appendPath(track.playbackId()).appendQueryParameter("id", track.id())
                .appendQueryParameter("br", quality.code);
        if (preferLocal) uri.appendQueryParameter("local", "1");
        var extras = new Bundle();
        extras.putString("lyricId", track.lyricId());
        extras.putString("coverId", track.coverId());
        Uri mediaUri = uri.build();
        var metadata = new MediaMetadata.Builder().setTitle(track.title()).setArtist(track.artist())
                .setExtras(extras).build();
        return new MediaItem.Builder().setMediaId(mediaUri.toString()).setUri(mediaUri)
                .setMediaMetadata(metadata).build();
    }

    static MusicApi.Track read(MediaItem item) {
        if (item == null) return null;
        Uri uri = Uri.parse(item.mediaId);
        MusicSource source = MusicSource.fromId(uri.getAuthority(), null);
        String playbackId = uri.getLastPathSegment();
        if (!"gdtrack".equals(uri.getScheme()) || source == null || playbackId == null) return null;
        String id = uri.getQueryParameter("id");
        if (id == null) id = playbackId;
        MediaMetadata metadata = item.mediaMetadata;
        String lyricId = metadata.extras == null ? id : metadata.extras.getString("lyricId", id);
        String coverId = metadata.extras == null ? "" : metadata.extras.getString("coverId", "");
        return new MusicApi.Track(source, id, playbackId, lyricId,
                metadata.title == null ? "" : metadata.title.toString(),
                metadata.artist == null ? "" : metadata.artist.toString(), coverId);
    }
}
