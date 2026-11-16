package org.gdmusic.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.Observer;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.google.common.util.concurrent.ListenableFuture;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class MainActivity extends Activity {
    private int pageColor;
    private int panelColor;
    private int controlColor;
    private int primaryText;
    private int secondaryText;
    private int actionGreen;
    private int greenInk;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final BlockingQueue<Runnable> searchQueue = new LinkedBlockingQueue<>();
    private final ThreadPoolExecutor searchExecutor =
            new ThreadPoolExecutor(1, 1, 0L, TimeUnit.MILLISECONDS, searchQueue);
    private Future<?> searchTask;
    private int searchGeneration;
    private String lastQuery = "";
    private MusicSource source = MusicSource.NETEASE;
    private Quality quality = Quality.STANDARD;
    private List<MusicApi.Track> results = Collections.emptyList();
    private List<MusicApi.Track> visibleTracks = Collections.emptyList();
    private boolean showingFavorites;
    private String playingTrackKey = "";
    private String searchMessage = "搜索歌曲或歌手开始播放";
    private final Map<String, WorkInfo> downloads = new HashMap<>();
    private final ArtworkLoader artwork = new ArtworkLoader();
    private final Map<String, Bitmap> recommendationArt = new HashMap<>();
    private String artworkKey = "";
    private Future<?> artworkTask;
    private LiveData<List<WorkInfo>> downloadWork;
    private final Observer<List<WorkInfo>> downloadObserver = this::updateDownloads;

    private ListenableFuture<MediaController> connection;
    private MediaController player;
    private EditText search;
    private Button sourceButton;
    private Button searchTab;
    private Button favoriteTab;
    private TextView brand;
    private LinearLayout searchForm;
    private TextView searchStatus;
    private ListView list;
    private TextView title;
    private TextView detail;
    private TextView elapsed;
    private TextView total;
    private LinearLayout libraryPage;
    private LinearLayout playerPage;
    private LinearLayout miniPlayer;
    private LinearLayout miniTrack;
    private ImageView miniCover;
    private ImageView playerCover;
    private TextView miniTitle;
    private TextView miniDetail;
    private ImageButton miniPlay;
    private ImageButton miniHeart;
    private ImageButton miniQueue;
    private ProgressBar miniProgress;
    private Button qualityButton;
    private Button lyricButton;
    private ImageButton heart;
    private LyricsDialog lyricsDialog;
    private SeekBar seek;
    private ImageButton previous;
    private ImageButton play;
    private ImageButton next;
    private boolean dragging;
    private android.window.OnBackInvokedCallback closePlayer;

    private final Runnable refreshProgress = new Runnable() {
        @Override public void run() {
            updateProgress();
            main.postDelayed(this, 500);
        }
    };

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        pageColor = getColor(R.color.page_background);
        panelColor = getColor(R.color.panel_background);
        controlColor = getColor(R.color.control_background);
        primaryText = getColor(R.color.primary_text);
        secondaryText = getColor(R.color.secondary_text);
        actionGreen = getColor(R.color.action_green);
        greenInk = getColor(R.color.green_ink);
        source = MusicSource.fromId(getPreferences(MODE_PRIVATE).getString("musicSource", ""),
                MusicSource.NETEASE);
        quality = Quality.fromCode(getPreferences(MODE_PRIVATE).getString("quality", ""));
        buildScreen();
        connectPlayer();
        loadRecommendationArt();
        downloadWork = WorkManager.getInstance(this).getWorkInfosByTagLiveData(FavoriteLibrary.WORK_TAG);
        for (var favorite : FavoriteLibrary.list(this)) {
            FavoriteLibrary.enqueue(this, favorite.track(), favorite.quality());
        }
        if (saved != null) {
            String query = saved.getString("query", "");
            search.setText(saved.getString("input", query));
            if (!query.isEmpty()) searchFor(query);
            if (saved.getBoolean("favorites")) showLibrary(true);
            if (saved.getBoolean("fullPlayer")) showPlayer(true);
        }
    }

    @Override protected void onStart() {
        super.onStart();
        main.post(refreshProgress);
        downloadWork.observeForever(downloadObserver);
    }

    @Override protected void onStop() {
        main.removeCallbacks(refreshProgress);
        downloadWork.removeObserver(downloadObserver);
        super.onStop();
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("query", lastQuery);
        out.putString("input", search.getText().toString());
        out.putBoolean("favorites", showingFavorites);
        out.putBoolean("fullPlayer", playerPage.getVisibility() == View.VISIBLE);
    }

    @Override protected void onDestroy() {
        searchExecutor.shutdownNow();
        artwork.close();
        showPlayer(false);
        if (lyricsDialog != null) lyricsDialog.dismiss();
        if (connection != null) MediaController.releaseFuture(connection);
        super.onDestroy();
    }

    private void buildScreen() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(pageColor);
        root.setFocusableInTouchMode(true);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                var bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int bottom = Math.max(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottom);
            }
            return insets;
        });
        if (android.os.Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        setContentView(root);
        libraryPage = column();
        root.addView(libraryPage, new FrameLayout.LayoutParams(-1, -1));
        playerPage = column();
        playerPage.setBackgroundColor(pageColor);
        playerPage.setVisibility(View.GONE);
        root.addView(playerPage, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(12), dp(20), dp(8));
        brand = label("GD Music", 23, primaryText, true);
        header.addView(brand, new LinearLayout.LayoutParams(-2, -2));
        View spacer = new View(this);
        header.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));
        sourceButton = new Button(this);
        sourceButton.setAllCaps(false);
        sourceButton.setTextColor(primaryText);
        sourceButton.setTextSize(14);
        sourceButton.setSingleLine(true);
        sourceButton.setEllipsize(TextUtils.TruncateAt.END);
        sourceButton.setPadding(dp(10), 0, dp(10), 0);
        sourceButton.setBackground(touchSurface(controlColor, 24));
        sourceButton.setOnClickListener(view -> selectSource());
        header.addView(sourceButton, new LinearLayout.LayoutParams(dp(122), dp(48)));
        updateSourceButton();
        libraryPage.addView(header);

        LinearLayout tabs = new LinearLayout(this);
        tabs.setBackgroundColor(panelColor);
        tabs.setPadding(dp(18), dp(4), dp(18), dp(4));
        searchTab = navigationButton("首页", R.drawable.nav_home);
        searchTab.setOnClickListener(view -> {
            if (!showingFavorites && !lastQuery.isEmpty()) clearSearch();
            showLibrary(false);
        });
        favoriteTab = navigationButton("我的", R.drawable.nav_person);
        favoriteTab.setOnClickListener(view -> showLibrary(true));
        tabs.addView(searchTab, new LinearLayout.LayoutParams(0, dp(58), 1));
        tabs.addView(favoriteTab, new LinearLayout.LayoutParams(0, dp(58), 1));

        LinearLayout form = new LinearLayout(this);
        searchForm = form;
        form.setGravity(Gravity.CENTER_VERTICAL);
        form.setPadding(dp(20), 0, dp(20), dp(6));
        search = new EditText(this);
        search.setSingleLine(true);
        search.setTextSize(16);
        search.setTextColor(primaryText);
        search.setHintTextColor(secondaryText);
        search.setHint("搜索歌曲或歌手");
        search.setContentDescription("搜索歌曲或歌手");
        search.setInputType(InputType.TYPE_CLASS_TEXT);
        search.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        search.setPadding(dp(14), 0, dp(10), 0);
        search.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.search_glyph, 0, 0, 0);
        search.setCompoundDrawablePadding(dp(8));
        search.setBackground(shaped(controlColor, 24));
        form.addView(search, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button searchButton = new Button(this);
        searchButton.setText("搜索");
        searchButton.setTextColor(primaryText);
        searchButton.setTextSize(15);
        searchButton.setBackground(touchSurface(actionGreen, 24));
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(dp(72), dp(48));
        searchParams.leftMargin = dp(8);
        form.addView(searchButton, searchParams);
        libraryPage.addView(form);
        searchButton.setOnClickListener(view -> submitSearch());
        search.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_SEARCH) return false;
            submitSearch();
            return true;
        });

        searchStatus = label("推荐音乐", 19, primaryText, true);
        searchStatus.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        searchStatus.setPadding(dp(20), dp(13), dp(20), dp(7));
        libraryPage.addView(searchStatus);

        list = new ListView(this);
        list.setDivider(null);
        list.setClipToPadding(false);
        list.setPadding(dp(12), 0, dp(12), dp(6));
        list.setOnItemClickListener((parent, view, position, id) -> playResults(position));
        list.setOnItemLongClickListener((parent, view, position, id) -> {
            showSongActions(visibleTracks.get(position));
            return true;
        });
        libraryPage.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        libraryPage.addView(buildMiniPlayer());
        libraryPage.addView(tabs);

        buildPlayerHeader();
        LinearLayout panel = column();
        panel.setPadding(dp(24), dp(16), dp(24), dp(16));
        LinearLayout trackHeader = new LinearLayout(this);
        trackHeader.setGravity(Gravity.CENTER_VERTICAL);
        title = label("未在播放", 24, primaryText, true);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        trackHeader.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        qualityButton = textButton(quality.label, 12);
        qualityButton.setContentDescription("音质，" + quality.label);
        qualityButton.setBackground(touchSurface(controlColor, 20));
        qualityButton.setOnClickListener(view -> chooseQuality());
        trackHeader.addView(qualityButton, new LinearLayout.LayoutParams(dp(86), dp(48)));
        lyricButton = textButton("歌词", 13);
        lyricButton.setOnClickListener(view -> {
            if (player != null && lyricsDialog == null) lyricsDialog = new LyricsDialog(this, player, () -> lyricsDialog = null);
        });
        trackHeader.addView(lyricButton, new LinearLayout.LayoutParams(dp(48), dp(48)));
        heart = iconButton(R.drawable.heart_off, "加入我的喜欢");
        heart.setOnClickListener(view -> {
            likeCurrent();
        });
        trackHeader.addView(heart, new LinearLayout.LayoutParams(dp(48), dp(48)));
        panel.addView(trackHeader);
        detail = label("", 13, secondaryText, false);
        detail.setSingleLine(true);
        detail.setEllipsize(TextUtils.TruncateAt.END);
        detail.setVisibility(View.GONE);
        panel.addView(detail);

        LinearLayout progress = new LinearLayout(this);
        progress.setGravity(Gravity.CENTER_VERTICAL);
        elapsed = label("0:00", 12, secondaryText, false);
        progress.addView(elapsed, new LinearLayout.LayoutParams(dp(45), -2));
        seek = new SeekBar(this);
        seek.setContentDescription("播放进度");
        seek.setMax(1000);
        progress.addView(seek, new LinearLayout.LayoutParams(0, dp(44), 1));
        total = label("0:00", 12, secondaryText, false);
        total.setGravity(Gravity.END);
        progress.addView(total, new LinearLayout.LayoutParams(dp(45), -2));
        panel.addView(progress);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int value, boolean fromUser) {
                if (fromUser && player != null && player.getDuration() > 0) {
                    elapsed.setText(time(player.getDuration() * value / bar.getMax()));
                }
            }

            @Override public void onStartTrackingTouch(SeekBar bar) { dragging = true; }

            @Override public void onStopTrackingTouch(SeekBar bar) {
                dragging = false;
                if (player != null && player.getDuration() > 0 && player.isCurrentMediaItemSeekable()) {
                    player.seekTo(player.getDuration() * bar.getProgress() / bar.getMax());
                }
            }
        });

        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        previous = control(R.drawable.media_previous, "上一首", false);
        previous.setOnClickListener(view -> step(false));
        play = control(R.drawable.media_play, "播放", true);
        play.setOnClickListener(view -> togglePlayback());
        next = control(R.drawable.media_next, "下一首", false);
        next.setOnClickListener(view -> step(true));
        controls.addView(previous, new LinearLayout.LayoutParams(dp(54), dp(50)));
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(dp(52), dp(48));
        playParams.setMargins(dp(15), 0, dp(15), 0);
        controls.addView(play, playParams);
        controls.addView(next, new LinearLayout.LayoutParams(dp(54), dp(50)));
        panel.addView(controls);
        playerPage.addView(panel);
        showLibrary(false);
        updatePlayer();
    }

    private LinearLayout buildMiniPlayer() {
        miniPlayer = column();
        var tray = shaped(panelColor, 0);
        float radius = dp(20);
        tray.setCornerRadii(new float[]{radius, radius, radius, radius, 0, 0, 0, 0});
        miniPlayer.setBackground(tray);
        miniPlayer.setClipToOutline(true);
        miniProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        miniProgress.setMax(1000);
        miniProgress.setProgressTintList(ColorStateList.valueOf(actionGreen));
        miniProgress.setProgressBackgroundTintList(ColorStateList.valueOf(controlColor));
        miniProgress.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        miniPlayer.addView(miniProgress, new LinearLayout.LayoutParams(-1, dp(2)));
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(5), dp(10), dp(5));
        miniTrack = new LinearLayout(this);
        miniTrack.setGravity(Gravity.CENTER_VERTICAL);
        miniTrack.setOnClickListener(view -> showPlayer(true));
        miniTrack.setFocusable(true);
        miniTrack.setMinimumHeight(dp(52));
        miniTrack.setBackground(touchSurface(12));
        miniCover = new ImageView(this);
        miniCover.setTag(8);
        setArtwork(miniCover, null, 10);
        miniTrack.addView(miniCover, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout names = column();
        names.setGravity(Gravity.CENTER_VERTICAL);
        names.setPadding(dp(11), 0, dp(5), 0);
        miniTitle = label("", 15, primaryText, true);
        miniDetail = label("", 12, secondaryText, false);
        for (TextView name : new TextView[]{miniTitle, miniDetail}) {
            name.setSingleLine(true);
            name.setEllipsize(TextUtils.TruncateAt.END);
            names.addView(name);
        }
        miniTrack.addView(names, new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(miniTrack, new LinearLayout.LayoutParams(0, -2, 1));
        miniHeart = iconButton(R.drawable.heart_off, "加入我的喜欢");
        miniHeart.setOnClickListener(view -> likeCurrent());
        miniPlay = iconButton(R.drawable.media_play, "播放");
        miniPlay.setOnClickListener(view -> togglePlayback());
        miniQueue = iconButton(R.drawable.media_queue, "播放队列");
        miniQueue.setOnClickListener(view -> showQueue());
        for (ImageButton action : new ImageButton[]{miniHeart, miniPlay, miniQueue}) {
            row.addView(action, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        miniPlayer.addView(row);
        return miniPlayer;
    }

    private void buildPlayerHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setPadding(dp(14), dp(8), dp(14), dp(8));
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageButton collapse = iconButton(R.drawable.media_collapse, "收起播放页");
        collapse.setOnClickListener(view -> showPlayer(false));
        header.addView(collapse, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView caption = label("正在播放", 14, secondaryText, true);
        caption.setGravity(Gravity.CENTER);
        header.addView(caption, new LinearLayout.LayoutParams(0, -2, 1));
        ImageButton queue = iconButton(R.drawable.media_queue, "播放队列");
        queue.setOnClickListener(view -> showQueue());
        header.addView(queue, new LinearLayout.LayoutParams(dp(48), dp(48)));
        playerPage.addView(header);
        FrameLayout area = new FrameLayout(this);
        playerCover = new ImageView(this);
        playerCover.setTag(34);
        setArtwork(playerCover, null, 22);
        area.addView(playerCover, new FrameLayout.LayoutParams(0, 0, Gravity.CENTER));
        area.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int side = Math.max(0, Math.min(Math.min(right - left - dp(44), bottom - top - dp(12)), dp(340)));
            var params = (FrameLayout.LayoutParams) playerCover.getLayoutParams();
            if (params.width != side) {
                params.width = params.height = side;
                playerCover.setLayoutParams(params);
            }
        });
        playerPage.addView(area, new LinearLayout.LayoutParams(-1, 0, 1));
    }

    private void showPlayer(boolean expanded) {
        if (expanded == (playerPage.getVisibility() == View.VISIBLE)) return;
        playerPage.setVisibility(expanded ? View.VISIBLE : View.GONE);
        libraryPage.setVisibility(expanded ? View.GONE : View.VISIBLE);
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if (expanded) {
                closePlayer = () -> showPlayer(false);
                getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                        android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, closePlayer);
            } else if (closePlayer != null) {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(closePlayer);
                closePlayer = null;
            }
        }
    }

    @Override public void onBackPressed() {
        if (playerPage.getVisibility() == View.VISIBLE) showPlayer(false);
        else if (showingFavorites) showLibrary(false);
        else if (!lastQuery.isEmpty()) clearSearch();
        else super.onBackPressed();
    }

    private void showQueue() {
        if (player == null || player.getMediaItemCount() == 0) return;
        String[] names = new String[player.getMediaItemCount()];
        for (int i = 0; i < names.length; i++) {
            var item = player.getMediaItemAt(i).mediaMetadata;
            names[i] = item.title + (TextUtils.isEmpty(item.artist) ? "" : " · " + item.artist);
        }
        new AlertDialog.Builder(this).setTitle("播放队列").setSingleChoiceItems(names,
                player.getCurrentMediaItemIndex(), (dialog, index) -> {
                    dialog.dismiss();
                    player.seekToDefaultPosition(index);
                    if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
                    player.play();
                }).setNegativeButton("关闭", null).show();
    }

    private void submitSearch() {
        String query = search.getText().toString().trim();
        if (query.isEmpty()) {
            clearSearch();
            return;
        }
        getSystemService(InputMethodManager.class).hideSoftInputFromWindow(search.getWindowToken(), 0);
        search.clearFocus();
        searchFor(query);
    }

    private void clearSearch() {
        searchGeneration++;
        lastQuery = "";
        if (searchTask != null) searchTask.cancel(true);
        searchQueue.clear();
        results = Collections.emptyList();
        search.setText("");
        search.clearFocus();
        getSystemService(InputMethodManager.class).hideSoftInputFromWindow(search.getWindowToken(), 0);
        if (!showingFavorites) renderLibrary();
    }

    private void searchFor(String query) {
        lastQuery = query;
        MusicSource selected = source;
        int generation = ++searchGeneration;
        if (searchTask != null) searchTask.cancel(true);
        searchQueue.clear();
        results = Collections.emptyList();
        searchMessage = "正在搜索 " + selected.label + "…";
        if (!showingFavorites) renderLibrary();
        searchTask = searchExecutor.submit(() -> {
            try {
                List<MusicApi.Track> found = MusicApi.INSTANCE.search(this, selected, query);
                main.post(() -> {
                    if (isDestroyed() || generation != searchGeneration) return;
                    results = found;
                    searchMessage = selected.label + " · " + (found.isEmpty() ? "没有找到歌曲" : found.size() + " 首");
                    if (!showingFavorites) renderLibrary();
                });
            } catch (IOException error) {
                main.post(() -> {
                    if (!isDestroyed() && generation == searchGeneration) {
                        searchMessage = error.getMessage() == null ? "搜索失败，请重试" : error.getMessage();
                        if (!showingFavorites) renderLibrary();
                    }
                });
            }
        });
    }

    private void selectSource() {
        MusicSource[] sources = MusicSource.values();
        String[] labels = new String[sources.length];
        for (int i = 0; i < sources.length; i++) labels[i] = sources[i].label;
        new AlertDialog.Builder(this).setTitle("选择音源")
                .setSingleChoiceItems(labels, source.ordinal(), (dialog, index) -> {
                    dialog.dismiss();
                    if (source == sources[index]) return;
                    source = sources[index];
                    getPreferences(MODE_PRIVATE).edit().putString("musicSource", source.id).apply();
                    updateSourceButton();
                    String query = search.getText().toString().trim();
                    if (!query.isEmpty()) submitSearch();
                    else clearSearch();
                }).show();
    }

    private void updateSourceButton() {
        sourceButton.setText(source.label + " ▾");
        sourceButton.setContentDescription("音源：" + source.label);
    }

    private void showLibrary(boolean favorites) {
        showingFavorites = favorites;
        brand.setText(favorites ? "我的" : "GD Music");
        searchForm.setVisibility(favorites ? View.GONE : View.VISIBLE);
        sourceButton.setVisibility(favorites ? View.INVISIBLE : View.VISIBLE);
        searchTab.setSelected(!favorites);
        favoriteTab.setSelected(favorites);
        searchTab.setTextColor(favorites ? secondaryText : greenInk);
        favoriteTab.setTextColor(favorites ? greenInk : secondaryText);
        searchTab.setCompoundDrawableTintList(ColorStateList.valueOf(favorites ? secondaryText : greenInk));
        favoriteTab.setCompoundDrawableTintList(ColorStateList.valueOf(favorites ? greenInk : secondaryText));
        renderLibrary();
    }

    private void renderLibrary() {
        if (showingFavorites) {
            List<MusicApi.Track> favorites = new ArrayList<>();
            for (var entry : FavoriteLibrary.list(this)) favorites.add(entry.track());
            visibleTracks = favorites;
            searchStatus.setText(favorites.isEmpty() ? "我的喜欢 · 暂无收藏" : "我的喜欢 · " + favorites.size() + " 首");
        } else if (lastQuery.isEmpty()) {
            visibleTracks = Recommendations.PICKS;
            searchStatus.setText("推荐音乐");
        } else {
            visibleTracks = results;
            searchStatus.setText(searchMessage);
        }
        boolean recommendations = !showingFavorites && lastQuery.isEmpty();
        searchStatus.setTextSize(recommendations || showingFavorites ? 19 : 13);
        searchStatus.setTextColor(recommendations || showingFavorites ? primaryText : secondaryText);
        searchStatus.setTypeface(Typeface.DEFAULT, recommendations || showingFavorites ? Typeface.BOLD : Typeface.NORMAL);
        list.setAdapter(new ArrayAdapter<MusicApi.Track>(this, android.R.layout.simple_list_item_1, visibleTracks) {
            @Override public int getViewTypeCount() { return 2; }

            @Override public int getItemViewType(int position) {
                return recommendations && position == 0 ? 1 : 0;
            }

            @Override public View getView(int position, View convertView, ViewGroup parent) {
                MusicApi.Track track = getItem(position);
                boolean featured = getItemViewType(position) == 1;
                SongRow row = convertView == null ? new SongRow(featured) : (SongRow) convertView;
                row.title.setText(track.title());
                String artist = track.artist().isEmpty() ? "未知歌手" : track.artist();
                row.subtitle.setText(showingFavorites ? artist + " · " + downloadLabel(track) : artist);
                boolean playing = playingTrackKey.equals(trackKey(track));
                row.title.setTextColor(playing ? greenInk : primaryText);
                row.subtitle.setTextColor(playing ? greenInk : secondaryText);
                row.art.setVisibility(recommendations ? View.VISIBLE : View.GONE);
                if (recommendations) setArtwork(row.art, recommendationArt.get(track.coverId()), featured ? 20 : 10);
                return row;
            }
        });
    }

    private void updateDownloads(List<WorkInfo> jobs) {
        downloads.clear();
        for (WorkInfo job : jobs) {
            for (String tag : job.getTags()) {
                if (!tag.startsWith(FavoriteLibrary.SONG_TAG)) continue;
                String key = tag.substring(FavoriteLibrary.SONG_TAG.length());
                if (!downloads.containsKey(key) || !job.getState().isFinished()) {
                    downloads.put(key, job);
                }
            }
        }
        if (showingFavorites && list.getAdapter() instanceof ArrayAdapter<?> adapter) adapter.notifyDataSetChanged();
    }

    private String downloadLabel(MusicApi.Track track) {
        if (track.source() == MusicSource.EMBEAT) return "仅在线播放";
        String key = FavoriteLibrary.key(track.source(), track.id());
        var entry = FavoriteLibrary.get(this, key);
        if (entry != null && FavoriteLibrary.localFile(this, key, entry.quality()).length() > 0) return "已下载";
        WorkInfo job = downloads.get(key);
        if (job != null && job.getState() == WorkInfo.State.RUNNING) return "下载中";
        if (job != null && job.getState() == WorkInfo.State.FAILED) {
            String reason = job.getOutputData().getString(FavoriteDownload.FAILURE_REASON);
            return (reason == null ? "下载失败" : reason) + "，可长按重试";
        }
        if (job != null && job.getRunAttemptCount() > 0) return "下载中断，等待重试";
        return "等待下载";
    }

    private void showSongActions(MusicApi.Track track) {
        String key = FavoriteLibrary.key(track.source(), track.id());
        var entry = FavoriteLibrary.get(this, key);
        if (entry == null) {
            new AlertDialog.Builder(this).setTitle(track.title()).setItems(new String[]{"加入我的喜欢"},
                    (dialog, index) -> toggleFavorite(track)).show();
            return;
        }
        var menu = new AlertDialog.Builder(this).setTitle(track.title()).setPositiveButton("移出我的喜欢",
                (dialog, which) -> toggleFavorite(track)).setNegativeButton("取消", null);
        WorkInfo job = downloads.get(key);
        if (track.source() != MusicSource.EMBEAT && FavoriteLibrary.localFile(this, key, entry.quality()).length() == 0
                && (job == null || job.getState() != WorkInfo.State.RUNNING)) {
            menu.setNeutralButton("重试下载", (dialog, which) -> FavoriteLibrary.retry(this, track, entry.quality()));
        }
        menu.show();
    }

    private void toggleFavorite(MusicApi.Track track) {
        String key = FavoriteLibrary.key(track.source(), track.id());
        if (FavoriteLibrary.get(this, key) != null) {
            FavoriteLibrary.remove(this, track);
            Toast.makeText(this, "已移出我的喜欢", Toast.LENGTH_SHORT).show();
        } else {
            FavoriteLibrary.add(this, track, quality);
            Toast.makeText(this, track.source() == MusicSource.EMBEAT ? "已收藏 · 仅在线播放" : "已收藏 · 自动下载到本地",
                    Toast.LENGTH_SHORT).show();
        }
        if (showingFavorites) renderLibrary();
        updateHeart();
    }

    private void chooseQuality() {
        Quality[] qualities = Quality.values();
        String[] labels = new String[qualities.length];
        for (int i = 0; i < qualities.length; i++) labels[i] = qualities[i].label + " · " + qualities[i].format;
        Quality current = TrackMedia.quality(player == null ? null : player.getCurrentMediaItem(), quality);
        new AlertDialog.Builder(this).setTitle("播放音质").setSingleChoiceItems(labels, current.ordinal(),
                (dialog, index) -> {
                    dialog.dismiss();
                    if (current == qualities[index] && quality == current) return;
                    quality = qualities[index];
                    getPreferences(MODE_PRIVATE).edit().putString("quality", quality.code).apply();
                    if (player == null || player.getCurrentMediaItem() == null) {
                        updateQualityBadge(quality);
                        return;
                    }
                    List<MediaItem> items = new ArrayList<>();
                    for (int i = 0; i < player.getMediaItemCount(); i++) {
                        MediaItem item = player.getMediaItemAt(i);
                        MusicApi.Track track = TrackMedia.read(item);
                        items.add(track == null ? item : TrackMedia.create(track, quality, false));
                    }
                    int position = player.getCurrentMediaItemIndex();
                    long time = player.getCurrentPosition();
                    boolean resume = player.getPlayWhenReady();
                    player.setMediaItems(items, position, time);
                    player.prepare();
                    player.setPlayWhenReady(resume);
                }).setNegativeButton("取消", null).show();
    }

    private final class SongRow extends LinearLayout {
        final ImageView art;
        final TextView title;
        final TextView subtitle;

        SongRow(boolean featured) {
            super(MainActivity.this);
            setGravity(Gravity.CENTER_VERTICAL);
            setMinimumHeight(dp(featured ? 144 : 68));
            setPadding(dp(featured ? 18 : 10), dp(9), dp(featured ? 18 : 10), dp(9));
            if (featured) setBackground(shaped(getColor(R.color.featured_background), 19));
            art = new ImageView(MainActivity.this);
            art.setTag(featured ? 12 : 8);
            int coverSize = dp(featured ? 96 : 49);
            var coverParams = new LinearLayout.LayoutParams(coverSize, coverSize);
            if (!featured) {
                coverParams.setMarginEnd(dp(12));
                addView(art, coverParams);
            }
            LinearLayout names = column();
            if (featured) {
                TextView feature = label("精选", 13, getColor(R.color.featured_ink), true);
                feature.setPadding(0, 0, 0, dp(6));
                names.addView(feature);
            }
            title = label("", featured ? 22 : 16, primaryText, featured);
            subtitle = label("", featured ? 15 : 13, secondaryText, false);
            for (TextView item : new TextView[]{title, subtitle}) {
                item.setSingleLine(true);
                item.setEllipsize(TextUtils.TruncateAt.END);
                names.addView(item);
            }
            addView(names, new LinearLayout.LayoutParams(0, -2, 1));
            if (featured) {
                coverParams.setMarginStart(dp(10));
                FrameLayout preview = new FrameLayout(MainActivity.this);
                preview.addView(art, new FrameLayout.LayoutParams(-1, -1));
                ImageView playPreview = new ImageView(MainActivity.this);
                playPreview.setImageResource(R.drawable.media_play);
                playPreview.setImageTintList(ColorStateList.valueOf(primaryText));
                playPreview.setBackground(shaped(panelColor, 20));
                playPreview.setPadding(dp(5), dp(5), dp(5), dp(5));
                var playParams = new FrameLayout.LayoutParams(dp(29), dp(29), Gravity.BOTTOM | Gravity.END);
                playParams.setMargins(dp(6), dp(6), dp(6), dp(6));
                preview.addView(playPreview, playParams);
                addView(preview, coverParams);
            }
        }
    }

    private void connectPlayer() {
        var token = new SessionToken(this, new ComponentName(this, PlaybackService.class));
        connection = new MediaController.Builder(this, token).buildAsync();
        connection.addListener(() -> {
            if (isDestroyed()) return;
            try {
                player = connection.get();
                player.addListener(new Player.Listener() {
                    @Override public void onEvents(Player player, Player.Events events) { updatePlayer(); }
                });
                updatePlayer();
            } catch (ExecutionException | InterruptedException error) {
                detail.setVisibility(View.VISIBLE);
                detail.setText("播放器连接失败，请重新打开");
                Toast.makeText(this, "播放器连接失败，请重新打开", Toast.LENGTH_SHORT).show();
            }
        }, main::post);
    }

    private void playResults(int position) {
        if (player == null) {
            Toast.makeText(this, "播放器暂未就绪", Toast.LENGTH_SHORT).show();
            return;
        }
        List<MediaItem> queue = new ArrayList<>();
        for (MusicApi.Track track : visibleTracks) {
            Quality requested = quality;
            if (showingFavorites) {
                String key = FavoriteLibrary.key(track.source(), track.id());
                var entry = FavoriteLibrary.get(this, key);
                if (entry != null && FavoriteLibrary.localFile(this, key, entry.quality()).length() > 0) {
                    requested = entry.quality();
                }
            }
            queue.add(TrackMedia.create(track, requested, showingFavorites));
        }
        player.setMediaItems(queue, position, C.TIME_UNSET);
        player.prepare();
        player.play();
    }

    private void togglePlayback() {
        if (player.getPlayerError() != null) {
            player.prepare();
            player.play();
        } else if (player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED) {
            player.pause();
        } else {
            if (player.getPlaybackState() == Player.STATE_ENDED) player.seekToDefaultPosition();
            player.play();
        }
    }

    private void step(boolean forward) {
        boolean failed = player.getPlayerError() != null;
        if (forward) player.seekToNextMediaItem();
        else player.seekToPreviousMediaItem();
        if (failed) {
            player.prepare();
            player.play();
        }
    }

    private void updatePlayer() {
        boolean hasSong = player != null && player.getCurrentMediaItem() != null;
        miniPlayer.setVisibility(hasSong ? View.VISIBLE : View.GONE);
        miniPlay.setEnabled(hasSong);
        miniHeart.setEnabled(hasSong);
        miniQueue.setEnabled(hasSong);
        play.setEnabled(hasSong);
        lyricButton.setEnabled(hasSong);
        heart.setEnabled(hasSong);
        updateHeart();
        updateQualityBadge(TrackMedia.quality(hasSong ? player.getCurrentMediaItem() : null, quality));
        previous.setEnabled(hasSong && player.hasPreviousMediaItem());
        next.setEnabled(hasSong && player.hasNextMediaItem());
        if (hasSong) {
            var metadata = player.getMediaMetadata();
            title.setText(metadata.title == null ? "" : metadata.title);
            String message = metadata.artist == null ? "" : metadata.artist.toString();
            if (player.getPlayerError() != null) message = "播放失败，可重试或切歌";
            else if (player.getPlaybackState() == Player.STATE_BUFFERING) message = "缓冲中…";
            detail.setText(message);
            detail.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
            miniTitle.setText(title.getText());
            miniDetail.setText(message);
            miniTrack.setContentDescription("展开播放页，" + title.getText()
                    + (message.isEmpty() ? "" : "，" + message));
        }
        boolean canPause = hasSong && player.getPlayerError() == null && player.getPlayWhenReady()
                && player.getPlaybackState() != Player.STATE_ENDED;
        for (ImageButton button : new ImageButton[]{play, miniPlay}) {
            button.setImageResource(canPause ? R.drawable.media_pause : R.drawable.media_play);
            button.setContentDescription(canPause ? "暂停" : "播放");
        }
        MusicApi.Track track = hasSong ? TrackMedia.read(player.getCurrentMediaItem()) : null;
        String activeKey = track == null ? "" : trackKey(track);
        if (!playingTrackKey.equals(activeKey)) {
            playingTrackKey = activeKey;
            if (list.getAdapter() instanceof ArrayAdapter<?> adapter) adapter.notifyDataSetChanged();
        }
        updateTrackArtwork(track);
        updateProgress();
    }

    private void updateProgress() {
        long duration = player == null ? 0 : Math.max(0, player.getDuration());
        long position = player == null ? 0 : player.getCurrentPosition();
        setTextIfChanged(total, time(duration));
        seek.setEnabled(duration > 0 && player.isCurrentMediaItemSeekable());
        int progress = duration > 0 ? (int) (position * seek.getMax() / duration) : 0;
        if (miniProgress.getProgress() != progress) miniProgress.setProgress(progress);
        if (!dragging) {
            setTextIfChanged(elapsed, time(position));
            if (seek.getProgress() != progress) seek.setProgress(progress);
        }
        if (lyricsDialog != null) lyricsDialog.update();
    }

    private void updateHeart() {
        MusicApi.Track track = player == null ? null : TrackMedia.read(player.getCurrentMediaItem());
        boolean liked = track != null && FavoriteLibrary.get(this, FavoriteLibrary.key(track.source(), track.id())) != null;
        for (ImageButton button : new ImageButton[]{heart, miniHeart}) {
            button.setImageResource(liked ? R.drawable.heart_on : R.drawable.heart_off);
            button.setImageTintList(ColorStateList.valueOf(liked ? greenInk : primaryText));
            button.setContentDescription(liked ? "移出我的喜欢" : "加入我的喜欢");
        }
    }

    private void likeCurrent() {
        MusicApi.Track track = player == null ? null : TrackMedia.read(player.getCurrentMediaItem());
        if (track != null) toggleFavorite(track);
    }

    private static String trackKey(MusicApi.Track track) {
        return track.source().id + ":" + track.id();
    }

    private void loadRecommendationArt() {
        for (var track : Recommendations.PICKS) {
            artwork.load(this, track, image -> {
                if (isDestroyed()) return;
                recommendationArt.put(track.coverId(), image);
                if (!showingFavorites && lastQuery.isEmpty() && list.getAdapter() instanceof ArrayAdapter<?> adapter) {
                    adapter.notifyDataSetChanged();
                }
            });
        }
    }

    private void updateTrackArtwork(MusicApi.Track track) {
        String key = track == null ? "" : track.source().id + ":" + track.coverId();
        if (key.equals(artworkKey)) return;
        artworkKey = key;
        if (artworkTask != null) artworkTask.cancel(true);
        Bitmap cached = track != null && track.source() == MusicSource.NETEASE ? recommendationArt.get(track.coverId()) : null;
        updateArtwork(cached);
        if (cached != null || track == null || track.coverId().isEmpty()) return;
        artworkTask = artwork.load(this, track, image -> {
            if (!isDestroyed() && key.equals(artworkKey)) updateArtwork(image);
        });
    }

    private void updateArtwork(Bitmap art) {
        setArtwork(miniCover, art, 10);
        setArtwork(playerCover, art, 22);
    }

    private void setArtwork(ImageView image, Bitmap art, int pad) {
        if (image.getBackground() == null) {
            image.setBackground(shaped(controlColor, (int) image.getTag()));
            image.setClipToOutline(true);
            image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        }
        int inset = art == null ? dp(pad) : 0;
        image.setPadding(inset, inset, inset, inset);
        if (art == null) {
            image.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
            image.setImageResource(R.drawable.music_note);
            image.setImageTintList(ColorStateList.valueOf(greenInk));
        } else {
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setImageTintList(null);
            image.setImageBitmap(art);
        }
    }

    private static void setTextIfChanged(TextView view, String text) {
        if (!TextUtils.equals(text, view.getText())) view.setText(text);
    }

    private void updateQualityBadge(Quality selection) {
        qualityButton.setText(selection.label);
        qualityButton.setContentDescription("音质，" + selection.label);
    }

    private Button textButton(String text, int size) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(size);
        button.setTextColor(primaryText);
        button.setAllCaps(false);
        button.setSingleLine(true);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(touchSurface(10));
        return button;
    }

    private Button navigationButton(String text, int icon) {
        Button button = textButton(text, 12);
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, dp(6), 0, dp(4));
        button.setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0);
        button.setCompoundDrawablePadding(dp(2));
        return button;
    }

    private ImageButton iconButton(int icon, String description) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(icon);
        button.setContentDescription(description);
        button.setImageTintList(ColorStateList.valueOf(primaryText));
        button.setBackground(touchSurface(12));
        return button;
    }

    private RippleDrawable touchSurface(int radius) {
        return new RippleDrawable(ColorStateList.valueOf(getColor(R.color.touch_ripple)), null, shaped(panelColor, radius));
    }

    private RippleDrawable touchSurface(int fill, int radius) {
        return new RippleDrawable(ColorStateList.valueOf(getColor(R.color.touch_ripple)), shaped(fill, radius), null);
    }

    private ImageButton control(int icon, String description, boolean primary) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(icon);
        button.setContentDescription(description);
        button.setImageTintList(new ColorStateList(
                new int[][]{new int[]{-android.R.attr.state_enabled}, new int[0]},
                new int[]{getColor(R.color.disabled_content), primaryText}));
        button.setBackground(touchSurface(primary ? actionGreen : panelColor, 25));
        return button;
    }

    private TextView label(String text, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private LinearLayout column() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        return view;
    }

    private GradientDrawable shaped(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static String time(long millis) {
        long seconds = Math.max(0, millis / 1000);
        return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }
}
