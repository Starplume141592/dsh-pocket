package com.dsh.remote;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.VpnService;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Pocket native shell: login to Tailscale once, bring up the embedded tunnel,
 * then discover the PC node on the tailnet and load the Pocket web UI.
 */
public class MainActivity extends Activity {
    private static final int REQ_VPN = 1001;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView status;
    private Button loginButton;

    private boolean vpnRequested = false;
    private boolean tunnelStartRequested = false;
    private boolean discovering = false;
    private String loadedUrl = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("Pocket");
        buildUi();
        Tunnel.get(this).ensureEngine();
        requestVpn();
        handler.post(poll);
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 8, 11));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(10), dp(12), dp(10));
        bar.setBackgroundColor(Color.rgb(13, 16, 22));

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(this);
        title.setText("Pocket");
        title.setTextColor(Color.WHITE);
        title.setTextSize(17);
        title.setTypeface(null, Typeface.BOLD);
        status = new TextView(this);
        status.setText("正在启动隧道…");
        status.setTextColor(Color.rgb(154, 164, 182));
        status.setTextSize(11);
        texts.addView(title);
        texts.addView(status);
        bar.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        loginButton = new Button(this);
        loginButton.setText("登录 Tailscale");
        loginButton.setVisibility(View.GONE);
        loginButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { beginLogin(); }
        });
        bar.addView(loginButton);

        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(7, 8, 11));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (status != null) status.setText("已连接 · " + Uri.parse(url).getHost());
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (isFinishing() || isDestroyed()) return;
            try {
                Tunnel tunnel = Tunnel.get(MainActivity.this);
                tunnel.refreshStatus();
                if (tunnel.needsLogin()) {
                    loginButton.setVisibility(View.VISIBLE);
                    status.setText("需要登录 Tailscale");
                } else if (tunnel.isRunning()) {
                    loginButton.setVisibility(View.GONE);
                    status.setText(loadedUrl.isEmpty() ? "隧道已连接，正在发现电脑…" : "已连接");
                    if (!tunnelStartRequested) startTunnelService();
                    if (loadedUrl.isEmpty() && !discovering) discover(tunnel);
                } else {
                    loginButton.setVisibility(tunnel.statusEverOk() ? View.GONE : View.VISIBLE);
                    status.setText("隧道连接中… " + tunnel.backendState());
                }
            } catch (Exception error) {
                status.setText("隧道状态读取失败：" + error.getMessage());
            }
            handler.postDelayed(this, 1500);
        }
    };

    private void requestVpn() {
        if (vpnRequested) return;
        vpnRequested = true;
        try {
            Intent prepare = VpnService.prepare(this);
            if (prepare != null) startActivityForResult(prepare, REQ_VPN);
            else startTunnelService();
        } catch (Exception error) {
            status.setText("无法请求 VPN 权限：" + error.getMessage());
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_VPN) {
            if (resultCode == RESULT_OK) startTunnelService();
            else status.setText("需要允许 VPN 才能连接电脑");
        }
    }

    private void startTunnelService() {
        tunnelStartRequested = true;
        try {
            Intent intent = new Intent(this, TailscaleVpnService.class)
                .setAction(TailscaleVpnService.ACTION_START);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
            else startService(intent);
        } catch (Exception error) {
            status.setText("启动隧道服务失败：" + error.getMessage());
        }
    }

    private void beginLogin() {
        try {
            Intent foreground = new Intent(this, TailscaleVpnService.class)
                .setAction(TailscaleVpnService.ACTION_START_FOREGROUND_ONLY);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(foreground);
            else startService(foreground);
        } catch (Exception ignored) {}
        String url = Tunnel.get(this).startLogin();
        if (url != null && !url.isEmpty()) {
            status.setText("在浏览器里完成 Tailscale 登录，然后回到 Pocket");
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
        } else {
            status.setText("正在准备 Tailscale 登录…");
        }
    }

    private void discover(final Tunnel tunnel) {
        discovering = true;
        status.setText("隧道已连接，正在发现电脑…");
        Discovery.find(tunnel, new Discovery.Callback() {
            @Override public void onFound(final String url) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        discovering = false;
                        load(url);
                    }
                });
            }

            @Override public void onFailed(final String reason) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        discovering = false;
                        status.setText(reason + " · 重试中");
                        handler.postDelayed(new Runnable() {
                            @Override public void run() {
                                if (!isFinishing() && loadedUrl.isEmpty()) discover(tunnel);
                            }
                        }, 6000);
                    }
                });
            }
        });
    }

    private void load(String url) {
        if (url == null || url.isEmpty() || url.equals(loadedUrl)) return;
        loadedUrl = url;
        status.setText("正在打开 Pocket…");
        web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
