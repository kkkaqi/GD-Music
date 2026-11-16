package org.gdmusic.android;

import android.content.Context;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

public final class FavoriteDownload extends Worker {
    static final String FAILURE_REASON = "failureReason";

    public FavoriteDownload(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        String key = getInputData().getString("key");
        if (key == null) return Result.failure();
        FavoriteLibrary.Entry favorite = FavoriteLibrary.get(context, key);
        if (favorite == null || favorite.track().source() == MusicSource.EMBEAT) return Result.success();
        File target = FavoriteLibrary.localFile(context, key, favorite.quality());
        if (target.length() > 0) return Result.success();
        MusicApi.Track track = favorite.track();
        Quality quality = favorite.quality();
        try {
            try {
                download(track, quality, target, key);
            } catch (MusicApi.NoAudio | AudioTransfer.HttpError error) {
                if (track.source() != MusicSource.YTMUSIC || isStopped() ||
                        (error instanceof AudioTransfer.HttpError http && !http.refreshAddress())) throw error;
                MusicApi.Track alternate = MusicApi.INSTANCE.findKuwoMatch(context, track);
                if (alternate == null || isStopped()) throw error;
                download(alternate, quality, target, key);
            }
            return Result.success();
        } catch (MusicApi.NoAudio error) {
            return failure("音源暂无可下载地址");
        } catch (AudioTransfer.HttpError error) {
            if (error.refreshAddress()) {
                invalidate(track, quality);
                return failure("音源拒绝下载（" + error.status + "）");
            }
            return getRunAttemptCount() < 2 ? Result.retry() : failure(error.getMessage());
        } catch (IOException error) {
            invalidate(track, quality);
            return !isStopped() && getRunAttemptCount() < 2 ? Result.retry() : failure("下载未完成");
        }
    }

    private static Result failure(String reason) {
        return Result.failure(new Data.Builder().putString(FAILURE_REASON, reason).build());
    }

    private static void invalidate(MusicApi.Track track, Quality quality) {
        MusicApi.INSTANCE.invalidateAudio(track.source(), track.playbackId(), quality);
        MusicApi.INSTANCE.invalidateAudio(track.source(), track.id(), quality);
    }

    private void download(MusicApi.Track track, Quality quality, File target, String key) throws IOException {
        try {
            transfer(track, quality, target, key);
        } catch (AudioTransfer.HttpError error) {
            if (!error.refreshAddress() || isStopped()) throw error;
            invalidate(track, quality);
            transfer(track, quality, target, key);
        } catch (IOException error) {
            invalidate(track, quality);
            throw error;
        }
    }

    private void transfer(MusicApi.Track track, Quality quality, File target, String key) throws IOException {
        Context context = getApplicationContext();
        String url = MusicApi.INSTANCE.audioUrl(context, track.source(), track.playbackId(), track.id(), quality);
        Files.createDirectories(target.toPath().getParent());
        File temporary = File.createTempFile("audio-", ".part", target.getParentFile());
        try {
            try (var output = Files.newOutputStream(temporary.toPath())) {
                var connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
                AudioTransfer.copy(connection, output, this::isStopped);
            }
            if (!isStopped() && FavoriteLibrary.get(context, key) != null) {
                Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
                Log.i("GDMusicDownload", "Saved " + target.length() + " bytes from " + track.source().id);
            }
        } finally {
            Files.deleteIfExists(temporary.toPath());
        }
    }
}
