package org.gdmusic.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.AbsListView;
import android.widget.FrameLayout;
import android.widget.ListView;
import android.widget.TextView;
import androidx.media3.common.Player;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;

final class LyricsDialog {
    private final Activity owner;
    private final Player player;
    private final AlertDialog dialog;
    private final ListView list;
    private final TextView message;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private Future<?> loading;
    private String trackKey;
    private List<Lyrics.Line> lines = Collections.emptyList();
    private int active = -1;
    private long resumeAt;

    LyricsDialog(Activity owner, Player player, Runnable dismissed) {
        this.owner = owner;
        this.player = player;
        FrameLayout body = new FrameLayout(owner);
        list = new ListView(owner);
        list.setDivider(null);
        list.setPadding(dp(18), 0, dp(18), 0);
        body.addView(list, new FrameLayout.LayoutParams(-1, Math.round(owner.getResources().getDisplayMetrics().heightPixels * .5f)));
        message = new TextView(owner);
        message.setTextSize(15);
        message.setGravity(Gravity.CENTER);
        message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(message, new FrameLayout.LayoutParams(-1, -1));
        list.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override public void onScrollStateChanged(AbsListView view, int state) {
                if (state == SCROLL_STATE_TOUCH_SCROLL) resumeAt = Long.MAX_VALUE;
                else if (state == SCROLL_STATE_IDLE && resumeAt == Long.MAX_VALUE) {
                    resumeAt = SystemClock.elapsedRealtime() + 3_000;
                }
            }
            @Override public void onScroll(AbsListView view, int first, int visible, int total) {}
        });
        list.setOnItemClickListener((adapter, view, index, id) -> {
            long time = lines.get(index).at();
            if (time >= 0 && player.isCurrentMediaItemSeekable()) {
                resumeAt = 0;
                player.seekTo(time);
            }
        });
        dialog = new AlertDialog.Builder(owner).setTitle("歌词").setView(body).setPositiveButton("关闭", null).create();
        dialog.setOnDismissListener(ignored -> {
            loader.shutdownNow();
            dismissed.run();
        });
        dialog.show();
        update();
    }

    void dismiss() { dialog.dismiss(); }

    void update() {
        MusicApi.Track track = TrackMedia.read(player.getCurrentMediaItem());
        String key = track == null ? "" : track.source().id + ":" + track.lyricId();
        if (!Objects.equals(trackKey, key)) {
            trackKey = key;
            if (loading != null) loading.cancel(true);
            lines = Collections.emptyList();
            active = -1;
            resumeAt = 0;
            list.setAdapter(null);
            message.setVisibility(View.VISIBLE);
            message.setText(track == null ? "未在播放" : "正在加载歌词…");
            dialog.setTitle(track == null ? "歌词" : track.title());
            if (track != null) {
                loading = loader.submit(() -> {
                    try {
                        var result = MusicApi.INSTANCE.lyrics(owner, track);
                        owner.runOnUiThread(() -> {
                            if (dialog.isShowing() && key.equals(trackKey)) showLines(result);
                        });
                    } catch (IOException error) {
                        owner.runOnUiThread(() -> {
                            if (dialog.isShowing() && key.equals(trackKey)) message.setText("歌词加载失败，请重试");
                        });
                    }
                });
            }
        }
        int index = Lyrics.active(lines, player.getCurrentPosition());
        if (index != active) {
            active = index;
            for (int i = 0; i < list.getChildCount(); i++) {
                paint((TextView) list.getChildAt(i), list.getFirstVisiblePosition() + i);
            }
            if (resumeAt == 0 && active >= 0) follow();
        }
        if (resumeAt != 0 && SystemClock.elapsedRealtime() >= resumeAt) {
            resumeAt = 0;
            if (active >= 0) follow();
        }
    }

    private void showLines(List<Lyrics.Line> result) {
        lines = result;
        if (result.isEmpty()) {
            message.setText("暂无歌词");
            return;
        }
        message.setVisibility(View.GONE);
        list.setAdapter(new ArrayAdapter<Lyrics.Line>(owner, android.R.layout.simple_list_item_1, result) {
            @Override public View getView(int position, View convertView, ViewGroup parent) {
                TextView line = convertView == null ? new TextView(owner) : (TextView) convertView;
                line.setText(getItem(position).text());
                line.setTextSize(17);
                line.setPadding(dp(8), dp(10), dp(8), dp(10));
                paint(line, position);
                return line;
            }
        });
        update();
    }

    private void follow() {
        list.setSelectionFromTop(active, list.getHeight() / 3);
    }

    private void paint(TextView line, int index) {
        line.setTextColor(owner.getColor(index == active ? R.color.green_ink : R.color.primary_text));
    }

    private int dp(int value) { return Math.round(value * owner.getResources().getDisplayMetrics().density); }
}
