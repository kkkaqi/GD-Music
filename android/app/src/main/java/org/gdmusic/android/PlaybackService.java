package org.gdmusic.android;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.io.IOException;
import java.util.Collections;

@OptIn(markerClass = UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
    private MediaSession session;
    private PlaybackRecovery recovery;

    @Override
    public void onCreate() {
        super.onCreate();
        var http = new DefaultHttpDataSource.Factory().setConnectTimeoutMs(12_000).setReadTimeoutMs(12_000)
                .setDefaultRequestProperties(Collections.singletonMap("Referer", WebsiteApi.ORIGIN + "/"));
        var resolver = new ResolvingDataSource.Factory(new DefaultDataSource.Factory(this, http), spec -> {
            Uri track = spec.uri;
            MusicSource source = MusicSource.fromId(track.getAuthority(), null);
            String id = track.getLastPathSegment();
            if (!"gdtrack".equals(track.getScheme()) || source == null || id == null) {
                throw new IOException("歌曲信息不完整");
            }
            String originalId = track.getQueryParameter("id");
            String key = FavoriteLibrary.key(source, originalId == null ? id : originalId);
            Quality quality = Quality.fromCode(track.getQueryParameter("br"));
            var local = FavoriteLibrary.localFile(this, key, quality);
            if (local.length() > 0) return spec.withUri(Uri.fromFile(local));
            var downloaded = FavoriteLibrary.anyLocalFile(this, key, quality);
            if (downloaded != null && "1".equals(track.getQueryParameter("local"))) {
                return spec.withUri(Uri.fromFile(downloaded));
            }
            try {
                String url = MusicApi.INSTANCE.audioUrl(this, source, id, originalId, quality);
                return spec.withUri(Uri.parse(url));
            } catch (IOException error) {
                if (downloaded != null) return spec.withUri(Uri.fromFile(downloaded));
                throw error;
            }
        });
        var media = new ProgressiveMediaSource.Factory(resolver)
                .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy() {
                    @Override public long getRetryDelayMsFor(LoadErrorInfo info) {
                        return PlaybackRecovery.missingAudio(info.exception)
                                ? C.TIME_UNSET : super.getRetryDelayMsFor(info);
                    }
                });
        var player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(media)
                .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();
        recovery = new PlaybackRecovery(this, player);
        Intent openApp = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session = new MediaSession.Builder(this, player)
                .setSessionActivity(PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE))
                .build();
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            recovery.close();
            session.getPlayer().release();
            session.release();
            session = null;
        }
        super.onDestroy();
    }
}
