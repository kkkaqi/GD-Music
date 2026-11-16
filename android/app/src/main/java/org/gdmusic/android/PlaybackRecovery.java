package org.gdmusic.android;

import android.content.Context;
import android.os.Handler;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlaybackException;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.IOException;
import java.util.EnumSet;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

final class PlaybackRecovery implements Player.Listener {
    private final Context context;
    private final ExoPlayer player;
    private final Handler main;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Future<?> search;
    private Attempt attempt;

    private static final class Attempt {
        final MusicApi.Track original;
        final int index;
        final EnumSet<MusicSource> tried = EnumSet.noneOf(MusicSource.class);
        final EnumSet<MusicSource> refreshed = EnumSet.noneOf(MusicSource.class);
        MediaItem item;
        MusicSource pendingSource;

        Attempt(MusicApi.Track original, MediaItem item, int index) {
            this.original = original;
            this.item = item;
            this.index = index;
            tried.add(original.source());
        }
    }

    PlaybackRecovery(Context context, ExoPlayer player) {
        this.context = context;
        this.player = player;
        main = new Handler(player.getApplicationLooper());
        player.addListener(this);
    }

    @Override public void onMediaItemTransition(MediaItem item, int reason) {
        if (attempt != null && (attempt.index != player.getCurrentMediaItemIndex()
                || !Objects.equals(attempt.item, item))) reset();
    }

    @Override public void onPlaybackStateChanged(int state) {
        if (state == Player.STATE_READY && attempt != null && attempt.pendingSource != null) {
            Toast.makeText(context, "已自动切换到" + attempt.pendingSource.label, Toast.LENGTH_SHORT).show();
            attempt.pendingSource = null;
        }
    }

    @Override public void onPlayerError(PlaybackException error) {
        if (!(error instanceof ExoPlaybackException exo) || exo.type != ExoPlaybackException.TYPE_SOURCE) return;
        MediaItem item = player.getCurrentMediaItem();
        MusicApi.Track track = TrackMedia.read(item);
        if (track == null) return;
        int index = player.getCurrentMediaItemIndex();
        if (attempt == null || attempt.index != index || !attempt.item.equals(item)) {
            reset();
            attempt = new Attempt(track, item, index);
        }
        Attempt current = attempt;
        Quality quality = TrackMedia.quality(item, Quality.STANDARD);
        MusicApi api = MusicApi.INSTANCE;
        api.invalidateAudio(track.source(), track.playbackId(), quality);
        api.invalidateAudio(track.source(), track.id(), quality);
        if (!missingAudio(error) && current.refreshed.add(track.source())) {
            main.post(() -> {
                if (isCurrent(current, error)) player.prepare();
            });
            return;
        }

        EnumSet<MusicSource> tried = current.tried.clone();
        search = executor.submit(() -> {
            MusicApi.Track alternate = null;
            for (MusicSource source : MusicSource.values()) {
                if (Thread.currentThread().isInterrupted()) return;
                if (!tried.add(source)) continue;
                try {
                    alternate = api.findMatch(context, current.original, source, 5);
                    if (alternate != null) break;
                } catch (IOException ignored) {
                    // Another provider may still have this recording.
                }
            }
            MusicApi.Track match = alternate;
            main.post(() -> apply(current, error, quality, tried, match));
        });
    }

    private void apply(Attempt current, PlaybackException error, Quality quality, EnumSet<MusicSource> tried,
                       MusicApi.Track match) {
        if (!isCurrent(current, error)) return;
        if (match == null) {
            reset();
            if (player.getPlayWhenReady() && player.hasNextMediaItem()) {
                player.seekToNextMediaItem();
                player.prepare();
            }
            return;
        }
        current.tried.addAll(tried);
        current.pendingSource = match.source();
        current.item = TrackMedia.create(match, quality, false);
        long position = player.getCurrentPosition();
        player.replaceMediaItem(current.index, current.item);
        player.seekTo(current.index, position);
        player.prepare();
    }

    private boolean isCurrent(Attempt current, PlaybackException error) {
        return attempt == current && player.getPlayerError() == error
                && player.getCurrentMediaItemIndex() == current.index && current.item.equals(player.getCurrentMediaItem());
    }

    static boolean missingAudio(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof MusicApi.NoAudio) return true;
        }
        return false;
    }

    private void reset() {
        attempt = null;
        if (search != null) search.cancel(true);
        search = null;
    }

    void close() {
        player.removeListener(this);
        reset();
        executor.shutdownNow();
        main.removeCallbacksAndMessages(null);
    }
}
