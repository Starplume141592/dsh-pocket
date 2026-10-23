package com.dsh.remote;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * Find the Pocket host on the tailnet. The host sidecar publishes the gateway
 * on :8443 inside the private tailnet; we probe every online peer and return
 * the Pocket app URL. No hostname/port typing, no QR pairing.
 */
public final class Discovery {

    private static final String TAG = "PocketDiscovery";
    private static final int PORT = 8443;

    public interface Callback {
        void onFound(String url);
        void onFailed(String reason);
    }

    public static void find(final Tunnel tunnel, final Callback cb) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    List<String> candidates = candidates(tunnel);
                    for (String host : candidates) {
                        if (probe(host)) {
                            cb.onFound("https://" + host + ":" + PORT + "/__dshapp/");
                            return;
                        }
                    }
                    cb.onFailed("未发现 Pocket 电脑端（共探测 " + candidates.size() + " 个候选）");
                } catch (Exception error) {
                    cb.onFailed(error.getMessage());
                }
            }
        }).start();
    }

    private static List<String> candidates(Tunnel tunnel) {
        List<String> hosts = new ArrayList<>();
        try {
            JSONArray peers = tunnel.peers();
            for (int i = 0; i < peers.length(); i++) {
                JSONObject peer = peers.optJSONObject(i);
                if (peer == null || !peer.optBoolean("Online", true)) continue;
                String dns = Tunnel.optString(peer, "DNSName");
                if (dns.endsWith(".")) dns = dns.substring(0, dns.length() - 1);
                if (!dns.isEmpty() && !hosts.contains(dns)) hosts.add(dns);
                JSONArray ips = peer.optJSONArray("TailscaleIPs");
                if (ips != null) {
                    for (int k = 0; k < ips.length(); k++) {
                        String ip = ips.optString(k);
                        if (!ip.isEmpty() && !hosts.contains(ip)) hosts.add(ip);
                    }
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "candidates: " + error.getMessage());
        }
        return hosts;
    }

    private static boolean probe(String host) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("https://" + host + ":" + PORT + "/__dshm/health").openConnection();
            if (connection instanceof HttpsURLConnection) {
                HttpsURLConnection https = (HttpsURLConnection) connection;
                https.setSSLSocketFactory(permissiveFactory());
                https.setHostnameVerifier(new HostnameVerifier() {
                    @Override public boolean verify(String name, javax.net.ssl.SSLSession session) {
                        return true;
                    }
                });
            }
            connection.setConnectTimeout(2500);
            connection.setReadTimeout(2500);
            connection.setRequestMethod("GET");
            connection.setInstanceFollowRedirects(false);
            int code = connection.getResponseCode();
            InputStream input = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (input == null) return false;
            byte[] buffer = new byte[2048];
            int read = input.read(buffer);
            input.close();
            if (read <= 0) return false;
            String body = new String(buffer, 0, read, "UTF-8");
            return body.contains("\"ok\":true") && body.contains("\"version\"");
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static SSLSocketFactory permissiveFactory() {
        try {
            TrustManager[] trust = new TrustManager[]{new X509TrustManager() {
                @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, trust, new SecureRandom());
            return context.getSocketFactory();
        } catch (Exception error) {
            return null;
        }
    }
}
