package org.gdmusic.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

final class WebsiteApi {
    static final String ORIGIN = "https://music.gdstudio.org";
    record Response(int status, String body) {}

    private record Request(String query, String value, Uri expected, AtomicBoolean sent,
                           CompletableFuture<Response> answer) {}

    private final ReentrantLock serial = new ReentrantLock();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable release = this::closeBrowser;
    private volatile Request pending;
    private WebView browser;
    private boolean ready;

    Response request(Context context, String query, String value) throws IOException {
        try {
            serial.lockInterruptibly();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("请求已取消", error);
        }
        Request request = new Request(query, value, Uri.parse(ORIGIN + "/api.php?" + query),
                new AtomicBoolean(), new CompletableFuture<>());
        try {
            main.post(() -> begin(context.getApplicationContext(), request));
            return request.answer().get(27, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            cancel(request);
            throw new IOException("请求已取消", error);
        } catch (TimeoutException error) {
            cancel(request);
            throw new IOException("音源连接超时，请重试", error);
        } catch (ExecutionException error) {
            throw new IOException("官网音源连接失败，请重试", error.getCause());
        } finally {
            serial.unlock();
        }
    }

    private void cancel(Request request) {
        request.answer().cancel(false);
        main.post(() -> {
            if (pending == request) fail(new IOException("请求已取消"));
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void begin(Context context, Request request) {
        if (request.answer().isDone()) return;
        main.removeCallbacks(release);
        pending = request;
        if (ready) {
            send(request);
            return;
        }
        try {
            browser = new WebView(context);
            var settings = browser.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMediaPlaybackRequiresUserGesture(true);
            browser.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest navigation) {
                    return true;
                }

                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest resource) {
                    if (allowed(resource)) return null;
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }

                @Override public void onPageFinished(WebView view, String url) {
                    if (view != browser || ready || !(ORIGIN + "/").equals(url)) return;
                    ready = true;
                    if (pending != null) send(pending);
                }

                @Override public void onReceivedError(WebView view, WebResourceRequest resource, WebResourceError error) {
                    if (view == browser && resource.isForMainFrame()) fail(new IOException("官网加载失败"));
                }

                @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    if (view == browser) fail(new IOException("官网解析器已关闭"));
                    return true;
                }
            });
            browser.loadUrl(ORIGIN + "/");
        } catch (RuntimeException error) {
            fail(error);
        }
    }

    private boolean allowed(WebResourceRequest resource) {
        Uri url = resource.getUrl();
        if (!ORIGIN.equals(url.getScheme() + "://" + url.getAuthority()) || !"GET".equals(resource.getMethod())) {
            return false;
        }
        String path = url.getPath();
        if (path == null) return false;
        if (resource.isForMainFrame()) return "/".equals(path) && url.getQuery() == null;
        if (path.startsWith("/js/") || "/time".equals(path)) return true;
        Request request = pending;
        if (!"/api.php".equals(path) || request == null || !url.getQueryParameterNames().contains("s")) return false;
        for (String name : request.expected().getQueryParameterNames()) {
            if (!request.expected().getQueryParameter(name).equals(url.getQueryParameter(name))) return false;
        }
        return request.sent().compareAndSet(false, true);
    }

    private void send(Request request) {
        browser.evaluateJavascript("""
                (function (query, value) {
                  window.__gdAndroidResponse = null;
                  (async function () {
                    const encoded = encodeURIComponent(value).replace(/[!'()*]/g,
                      ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
                    const response = await fetch('/api.php?' + query + '&s=' +
                      encodeURIComponent(String(crc32(encoded))));
                    const body = await response.text();
                    return body.length <= 524288 ? {status: response.status, body} : {status: 0};
                  })().then(answer => window.__gdAndroidResponse = answer,
                            () => window.__gdAndroidResponse = {status: 0});
                  return true;
                })(
                """ + JSONObject.quote(request.query()) + ", " + JSONObject.quote(request.value()) + ")", started -> {
            if (pending != request) return;
            if ("true".equals(started)) poll(request);
            else fail(new IOException("官网解析启动失败"));
        });
    }

    private void poll(Request request) {
        if (pending != request) return;
        browser.evaluateJavascript("JSON.stringify(window.__gdAndroidResponse)", encoded -> {
            if (pending != request) return;
            try {
                Object value = new JSONTokener(encoded).nextValue();
                if (!(value instanceof String payload) || payload.equals("null")) {
                    main.postDelayed(() -> poll(request), 200);
                    return;
                }
                JSONObject result = new JSONObject(payload);
                int status = result.getInt("status");
                if (status == 0) {
                    fail(new IOException("官网音源返回异常"));
                    return;
                }
                String body = result.getString("body");
                pending = null;
                if (status == 401 || status == 403) closeBrowser();
                else main.postDelayed(release, 45_000);
                request.answer().complete(new Response(status, body));
            } catch (JSONException error) {
                fail(error);
            }
        });
    }

    private void fail(Throwable error) {
        Request request = pending;
        pending = null;
        closeBrowser();
        if (request != null) request.answer().completeExceptionally(error);
    }

    private void closeBrowser() {
        main.removeCallbacks(release);
        ready = false;
        WebView view = browser;
        browser = null;
        if (view != null) view.destroy();
    }
}
