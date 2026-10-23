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
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
    private FrameLayout loginLayer;
    private TextView welcomeStatus;
    private Button welcomePrimary;
    private Button welcomeCheck;

    private boolean vpnRequested = false;
    private boolean tunnelStartRequested = false;
    private boolean discovering = false;
    private String loadedUrl = "";
    private int loginAttempts = 0;
    private boolean loginPending = false;

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
        settings.setUserAgentString(settings.getUserAgentString() + " PocketShell/0.5.0");
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
        FrameLayout stack = new FrameLayout(this);
        stack.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildLoginLayer(stack);
        setContentView(stack);
    }

    private void buildLoginLayer(FrameLayout stack) {
        loginLayer = new FrameLayout(this);
        loginLayer.setBackgroundColor(Color.rgb(6, 17, 22));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);

        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setGravity(Gravity.CENTER_HORIZONTAL);
        wrap.setPadding(dp(28), dp(32), dp(28), dp(34));

        TextView logo = new TextView(this);
        logo.setText("✦");
        logo.setTextSize(28);
        logo.setTextColor(Color.rgb(94, 234, 212));
        logo.setGravity(Gravity.CENTER);
        android.graphics.drawable.GradientDrawable logoBg = new android.graphics.drawable.GradientDrawable();
        logoBg.setColor(Color.rgb(13, 38, 46));
        logoBg.setCornerRadius(dp(19));
        logo.setBackground(logoBg);
        wrap.addView(logo, new LinearLayout.LayoutParams(dp(64), dp(64)));

        TextView title = new TextView(this);
        title.setText("Pocket");
        title.setTextColor(Color.rgb(232, 244, 244));
        title.setTextSize(30);
        title.setTypeface(null, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = dp(18);
        wrap.addView(title, titleParams);

        TextView subtitle = new TextView(this);
        subtitle.setText("把电脑上的 DSH 带到手机");
        subtitle.setTextColor(Color.rgb(138, 163, 170));
        subtitle.setTextSize(13);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subtitleParams.topMargin = dp(5);
        wrap.addView(subtitle, subtitleParams);

        LinearLayout steps = new LinearLayout(this);
        steps.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams stepsParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stepsParams.topMargin = dp(30);
        wrap.addView(steps, stepsParams);
        addStep(steps, "1", "登录 Tailscale", "用和电脑相同的账号");
        addStep(steps, "2", "允许 VPN", "建立一条只属于你的私有隧道");
        addStep(steps, "3", "自动发现", "不用二维码，也不用填地址");

        welcomeStatus = new TextView(this);
        welcomeStatus.setText("准备连接…");
        welcomeStatus.setTextColor(Color.rgb(138, 163, 170));
        welcomeStatus.setTextSize(12);
        welcomeStatus.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = dp(22);
        wrap.addView(welcomeStatus, statusParams);

        welcomePrimary = new Button(this);
        welcomePrimary.setText("在浏览器登录 Tailscale");
        welcomePrimary.setAllCaps(false);
        welcomePrimary.setTextSize(14);
        welcomePrimary.setTextColor(Color.rgb(5, 37, 42));
        welcomePrimary.setTypeface(null, Typeface.BOLD);
        android.graphics.drawable.GradientDrawable buttonBg = new android.graphics.drawable.GradientDrawable();
        buttonBg.setColor(Color.rgb(94, 234, 212));
        buttonBg.setCornerRadius(dp(14));
        welcomePrimary.setBackground(buttonBg);
        welcomePrimary.setStateListAnimator(null);
        welcomePrimary.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { beginLogin(); }
        });
        LinearLayout.LayoutParams primaryParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(50));
        primaryParams.topMargin = dp(16);
        wrap.addView(welcomePrimary, primaryParams);

        welcomeCheck = new Button(this);
        welcomeCheck.setText("检查连接");
        welcomeCheck.setAllCaps(false);
        welcomeCheck.setTextSize(13);
        welcomeCheck.setTextColor(Color.rgb(138, 163, 170));
        welcomeCheck.setBackgroundColor(Color.TRANSPARENT);
        welcomeCheck.setStateListAnimator(null);
        welcomeCheck.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                vpnRequested = false;
                tunnelStartRequested = false;
                requestVpn();
                Tunnel tunnel = Tunnel.get(MainActivity.this);
                if (tunnel.isLoggedIn() && !tunnel.isRunning()) startTunnelService();
                else if (!tunnel.isLoggedIn()) beginLogin();
                else discover(tunnel);
            }
        });
        LinearLayout.LayoutParams checkParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42));
        checkParams.topMargin = dp(6);
        wrap.addView(welcomeCheck, checkParams);

        TextView footnote = new TextView(this);
        footnote.setText("登录一次后会记住，下次打开自动连接。");
        footnote.setTextColor(Color.rgb(95, 122, 130));
        footnote.setTextSize(11);
        footnote.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams footParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        footParams.topMargin = dp(18);
        wrap.addView(footnote, footParams);

        scroll.addView(wrap, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        loginLayer.addView(scroll, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        stack.addView(loginLayer, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void addStep(LinearLayout parent, String number, String title, String subtitle) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));

        TextView no = new TextView(this);
        no.setText(number);
        no.setTextSize(11);
        no.setTextColor(Color.rgb(94, 234, 212));
        no.setGravity(Gravity.CENTER);
        android.graphics.drawable.GradientDrawable noBg = new android.graphics.drawable.GradientDrawable();
        noBg.setColor(Color.rgb(13, 38, 46));
        noBg.setCornerRadius(dp(9));
        no.setBackground(noBg);
        row.addView(no, new LinearLayout.LayoutParams(dp(26), dp(26)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        copyParams.leftMargin = dp(13);
        TextView name = new TextView(this);
        name.setText(title);
        name.setTextColor(Color.rgb(232, 244, 244));
        name.setTextSize(14);
        name.setTypeface(null, Typeface.BOLD);
        TextView sub = new TextView(this);
        sub.setText(subtitle);
        sub.setTextColor(Color.rgb(138, 163, 170));
        sub.setTextSize(12);
        sub.setPadding(0, dp(2), 0, 0);
        copy.addView(name);
        copy.addView(sub);
        row.addView(copy, copyParams);
        parent.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (isFinishing() || isDestroyed()) return;
            try {
                final Tunnel tunnel = Tunnel.get(MainActivity.this);
                tunnel.refreshStatus();
                loginButton.setVisibility(View.GONE);
                if (tunnel.isRunning()) {
                    if (loadedUrl.isEmpty()) {
                        showWelcome("已连接 Tailscale，正在寻找电脑…");
                        welcomePrimary.setText("重新发现");
                        welcomePrimary.setOnClickListener(new View.OnClickListener() {
                            @Override public void onClick(View v) { loadedUrl = ""; discover(tunnel); }
                        });
                        if (!discovering) discover(tunnel);
                    } else {
                        hideLogin();
                        status.setText("已连接");
                    }
                    if (!tunnelStartRequested) startTunnelService();
                } else if (tunnel.needsLogin()) {
                    showWelcome("需要登录 Tailscale");
                    welcomePrimary.setText("在浏览器登录 Tailscale");
                    welcomePrimary.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) { beginLogin(); }
                    });
                } else if (tunnel.isLoggedIn()) {
                    showWelcome("正在恢复上次连接…");
                    welcomePrimary.setText("重新连接");
                    welcomePrimary.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) {
                            tunnelStartRequested = false;
                            startTunnelService();
                        }
                    });
                    if (!tunnelStartRequested) startTunnelService();
                } else {
                    showWelcome("准备连接…");
                    welcomePrimary.setText("在浏览器登录 Tailscale");
                    welcomePrimary.setOnClickListener(new View.OnClickListener() {
                        @Override public void onClick(View v) { beginLogin(); }
                    });
                }
            } catch (Exception error) {
                showWelcome("隧道状态读取失败");
                status.setText("隧道状态读取失败：" + error.getMessage());
            }
            handler.postDelayed(this, 1500);
        }
    };

    private void showWelcome(String message) {
        if (loginLayer != null) loginLayer.setVisibility(View.VISIBLE);
        if (welcomeStatus != null) welcomeStatus.setText(message);
        if (status != null) status.setText(message);
    }

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
            if (resultCode == RESULT_OK) {
                startTunnelService();
                if (loginPending) {
                    loginPending = false;
                    handler.postDelayed(new Runnable() {
                        @Override public void run() {
                            if (!isFinishing()) beginLogin();
                        }
                    }, 400);
                }
            } else {
                loginPending = false;
                vpnRequested = false;
                status.setText("需要允许 VPN 才能连接电脑；再点一次登录可重新授权");
            }
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
        // OAuth providers reject embedded WebViews; send Tailscale login to the
        // system browser and keep polling the engine for the result.
        try {
            if (VpnService.prepare(this) != null) {
                loginPending = true;
                requestVpn();
                return;
            }
        } catch (Exception ignored) {}
        try {
            Intent foreground = new Intent(this, TailscaleVpnService.class)
                .setAction(TailscaleVpnService.ACTION_START_FOREGROUND_ONLY);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(foreground);
            else startService(foreground);
        } catch (Exception ignored) {}
        Tunnel tunnel = Tunnel.get(this);
        String url = tunnel.startLogin();
        if (url == null || url.isEmpty()) url = tunnel.authURL();
        if (url != null && !url.isEmpty()) {
            loginAttempts = 0;
            if (openInBrowser(url)) {
                showWelcome("已在浏览器打开 Tailscale，登录完成后回到 Pocket");
                welcomePrimary.setText("重新打开登录页");
                return;
            }
            showWelcome("没有找到系统浏览器，请手动打开 Tailscale");
            return;
        }
        loginAttempts++;
        if (loginAttempts <= 6) {
            showWelcome("正在准备 Tailscale 登录… (" + loginAttempts + ")");
            handler.postDelayed(new Runnable() {
                @Override public void run() {
                    if (!isFinishing()) beginLogin();
                }
            }, 1200);
        } else {
            showWelcome("登录地址没有生成，请检查网络后重试");
        }
    }

    private boolean openInBrowser(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void hideLogin() {
        if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
            loginLayer.setVisibility(View.GONE);
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
        if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
            hideLogin();
            return;
        }
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
