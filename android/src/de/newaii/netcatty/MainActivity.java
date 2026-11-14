package de.newaii.netcatty;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import com.jcraft.jsch.ChannelDirectTCPIP;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.KeyPair;
import com.jcraft.jsch.ProxyHTTP;
import com.jcraft.jsch.ProxySOCKS5;
import com.jcraft.jsch.SftpATTRS;
import com.jcraft.jsch.SftpProgressMonitor;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;

import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.TimeZone;
import java.util.Vector;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import android.database.Cursor;
import android.provider.OpenableColumns;

/**
 * Netcatty Mate Mobile - Native Android Host & SSHv2 / SFTP / PortForward Engine
 * Powered by mwiede/jsch 0.2.21 + BouncyCastle 1.79
 * Hosts the full official Netcatty React 19 + Tailwind CSS + Radix UI + xterm.js 5.5.0 frontend.
 */
public class MainActivity extends Activity {

    static {
        try {
            Security.removeProvider("BC");
            Security.insertProviderAt(new BouncyCastleProvider(), 1);
            // Force mwiede/jsch on Android (JavaVersion=8) to use BouncyCastle for X25519/X448 & Ed25519/Ed448!
            JSch.setConfig("xdh", "com.jcraft.jsch.bc.XDH");
            JSch.setConfig("keypairgen.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA");
            JSch.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519");
            JSch.setConfig("ssh-ed448", "com.jcraft.jsch.bc.SignatureEd448");
        } catch (Throwable ignored) {
        }
    }

    private WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService ioPool = Executors.newCachedThreadPool();

    private static class SshContext {
        String sessionId;
        String hostId;
        String hostname;
        int port;
        String username;
        JSONObject rawOptions;
        List<Session> jumpSessions = new ArrayList<>();
        Session session;
        ChannelShell shellChannel;
        OutputStream shellOut;
        // Stats delta state
        long prevCpuTotal = 0;
        long prevCpuIdle = 0;
        long prevNetTime = 0;
        Map<String, long[]> prevNetIfaces = new ConcurrentHashMap<>();
    }

    private static class SftpContext {
        String sftpId;
        String sourceSessionId;
        String hostId;
        JSONObject rawOptions;
        List<Session> jumpSessions = new ArrayList<>();
        Session dedicatedSession; // non-null if not borrowed from sshSessions
        Session activeSession;
        ChannelSftp channel;
    }

    private static class PortForwardContext {
        String tunnelId;
        String ruleId;
        Session session;
        List<Session> jumpSessions = new ArrayList<>();
        ServerSocket dynamicServer;
        String type;
        String bindAddress;
        int localPort;
        String remoteHost;
        int remotePort;
        String status = "active";
        String error;
        AtomicInteger activeConnections = new AtomicInteger(0);
    }

    private final ConcurrentHashMap<String, SshContext> sshSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, SftpContext> sftpSessions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Process> localShells = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Socket> tcpSockets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, PortForwardContext> activeForwards = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> cancelledTransfers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, HttpURLConnection> activeAiStreams = new ConcurrentHashMap<>();

    private static final int REQ_IMPORT_FILE = 9001;
    private volatile String pendingImportCallbackId = null;
    private long lastBackPressTime = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window window = getWindow();
        if (window != null) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#090d16"));
            window.setNavigationBarColor(Color.parseColor("#090d16"));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
            }
        }

        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#090d16"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090d16"));
        setupWebView(webView);

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top = 0;
                int bottom = 0;
                int left = 0;
                int right = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Insets sysBars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                    Insets ime = insets.getInsets(WindowInsets.Type.ime());
                    top = sysBars.top;
                    left = sysBars.left;
                    right = sysBars.right;
                    bottom = Math.max(sysBars.bottom, ime.bottom);
                } else {
                    top = insets.getSystemWindowInsetTop();
                    left = insets.getSystemWindowInsetLeft();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                v.setPadding(left, top, right, bottom);
                return insets;
            }
        });

        setContentView(root);

        seedDefaultSandboxFiles();
        webView.loadUrl("https://appassets.netcatty.local/index.html");
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript(
                    "(function(){ try { return window.__netcattyHandleBackPress ? Boolean(window.__netcattyHandleBackPress()) : false; } catch(e) { return false; } })()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if ("true".equals(value)) {
                                return;
                            }
                            long now = System.currentTimeMillis();
                            if (now - lastBackPressTime < 2000L) {
                                moveTaskToBack(true);
                            } else {
                                lastBackPressTime = now;
                                Toast.makeText(MainActivity.this, "再按一次退至后台（保持 SSH 连接不断开）", Toast.LENGTH_SHORT).show();
                            }
                        }
                    });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_IMPORT_FILE) {
            final String cbId = pendingImportCallbackId;
            pendingImportCallbackId = null;
            if (cbId == null) return;
            if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                try {
                    JSONObject ev = new JSONObject();
                    ev.put("callbackId", cbId);
                    ev.put("canceled", true);
                    emitToJs("dialog:open-file-result", ev);
                } catch (Exception ignored) {}
                return;
            }
            final Uri uri = data.getData();
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        String fileName = "imported_file";
                        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                            if (cursor != null && cursor.moveToFirst()) {
                                int nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                                if (nameIdx >= 0) {
                                    String n = cursor.getString(nameIdx);
                                    if (n != null && !n.trim().isEmpty()) fileName = n.trim();
                                }
                            }
                        } catch (Exception ignored) {}
                        File importDir = new File(getFilesDir(), "Imports");
                        if (!importDir.exists()) importDir.mkdirs();
                        String safeName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
                        File destFile = new File(importDir, safeName);
                        try (InputStream is = getContentResolver().openInputStream(uri);
                             FileOutputStream fos = new FileOutputStream(destFile, false)) {
                            if (is != null) {
                                byte[] buf = new byte[16384];
                                int n;
                                while ((n = is.read(buf)) > 0) {
                                    fos.write(buf, 0, n);
                                }
                            }
                            fos.flush();
                        }
                        JSONObject ev = new JSONObject();
                        ev.put("callbackId", cbId);
                        ev.put("canceled", false);
                        ev.put("filePath", destFile.getAbsolutePath());
                        ev.put("fileName", safeName);
                        emitToJs("dialog:open-file-result", ev);
                    } catch (Exception e) {
                        try {
                            JSONObject ev = new JSONObject();
                            ev.put("callbackId", cbId);
                            ev.put("canceled", true);
                            ev.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("dialog:open-file-result", ev);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".map")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private void seedDefaultSandboxFiles() {
        ioPool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    File home = getFilesDir();
                    File sshDir = new File(home, ".ssh");
                    if (!sshDir.exists()) sshDir.mkdirs();
                    File dlDir = new File(home, "Downloads");
                    if (!dlDir.exists()) dlDir.mkdirs();
                    File knownHosts = new File(sshDir, "known_hosts");
                    synchronized (hostKeyFileLock) {
                        if (!knownHosts.exists()) {
                            writeTextFile(knownHosts, "# Netcatty Mate Android SSH known_hosts\n");
                        }
                    }
                    File readme = new File(dlDir, "README-Netcatty-Mobile.txt");
                    if (!readme.exists()) {
                        writeTextFile(readme,
                                "Netcatty Mate Mobile (Android Native JSch + BouncyCastle Edition)\n"
                                + "==================================================================\n"
                                + "- Full SSHv2 PTY Terminal (xterm.js 5.5.0)\n"
                                + "- SFTP: Browse, download, upload and manage remote files.\n"
                                + "- Cloud Sync Pull-Only Mode: Vault synchronization is strictly read-only pull.\n");
                    }
                } catch (Exception ignored) {
                }
            }
        });
    }

    private void writeTextFile(File f, String content) throws Exception {
        try (FileOutputStream fos = new FileOutputStream(f, false)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
        }
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void setupWebView(WebView wv) {
        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        wv.addJavascriptInterface(new NetcattyNativeBridge(), "NativeBridge");

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return super.onConsoleMessage(consoleMessage);
            }
        });

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null && "appassets.netcatty.local".equalsIgnoreCase(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/index.html";
                    }
                    String assetPath = "www" + (path.startsWith("/") ? path : ("/" + path));
                    try {
                        InputStream is = getAssets().open(assetPath);
                        String mime = guessMimeType(assetPath);
                        String encoding = (mime.startsWith("text/") || "application/javascript".equals(mime) || "application/json".equals(mime) || "image/svg+xml".equals(mime))
                                ? "UTF-8" : null;
                        WebResourceResponse resp = new WebResourceResponse(mime, encoding, is);
                        Map<String, String> headers = new ConcurrentHashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        headers.put("Cache-Control", "no-cache");
                        resp.setResponseHeaders(headers);
                        return resp;
                    } catch (Exception ignored) {
                        Map<String, String> headers = new ConcurrentHashMap<>();
                        headers.put("Access-Control-Allow-Origin", "*");
                        if (!path.contains(".")) {
                            try {
                                InputStream indexStream = getAssets().open("www/index.html");
                                WebResourceResponse spaResp = new WebResourceResponse("text/html", "UTF-8", indexStream);
                                spaResp.setResponseHeaders(headers);
                                return spaResp;
                            } catch (Exception ignoredSpa) {
                            }
                        }
                        return new WebResourceResponse(
                                "text/plain",
                                "UTF-8",
                                404,
                                "Not Found",
                                headers,
                                new ByteArrayInputStream(new byte[0]));
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri != null) {
                    String scheme = uri.getScheme();
                    if ("file".equalsIgnoreCase(scheme) || "appassets.netcatty.local".equalsIgnoreCase(uri.getHost())) {
                        return false;
                    }
                    if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                        try {
                            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                            startActivity(intent);
                        } catch (Exception ignored) {
                        }
                        return true;
                    }
                }
                return false;
            }
        });
    }

    private void emitToJs(final String eventType, final JSONObject payload) {
        final String jsonStr = payload.toString();
        final String b64 = Base64.encodeToString(jsonStr.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.__onNativeEvent && window.__onNativeEvent('" + eventType + "','" + b64 + "');",
                            null);
                }
            }
        });
    }

    private void emitRawTerminalBytes(final String sessionId, byte[] buf, int len) {
        if (len <= 0) return;
        byte[] slice = new byte[len];
        System.arraycopy(buf, 0, slice, 0, len);
        final String b64 = Base64.encodeToString(slice, Base64.NO_WRAP);
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.__onTerminalBytesB64 && window.__onTerminalBytesB64('" + sessionId + "','" + b64 + "');",
                            null);
                }
            }
        });
    }

    private void closeSessionInternal(String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) return;
        SshContext sc = sshSessions.remove(sessionId);
        if (sc != null) {
            try {
                if (sc.shellOut != null) sc.shellOut.close();
            } catch (Exception ignored) {}
            try {
                if (sc.shellChannel != null && sc.shellChannel.isConnected()) sc.shellChannel.disconnect();
            } catch (Exception ignored) {}
            try {
                if (sc.session != null && sc.session.isConnected()) sc.session.disconnect();
            } catch (Exception ignored) {}
            for (Session js : sc.jumpSessions) {
                try {
                    if (js != null && js.isConnected()) js.disconnect();
                } catch (Exception ignored) {}
            }
        }
        Process proc = localShells.remove(sessionId);
        if (proc != null) {
            try {
                proc.destroy();
            } catch (Exception ignored) {}
        }
        Socket sock = tcpSockets.remove(sessionId);
        if (sock != null) {
            try {
                sock.close();
            } catch (Exception ignored) {}
        }
    }

    private void closeSftpInternal(String sftpId) {
        if (sftpId == null || sftpId.isEmpty()) return;
        SftpContext sfc = sftpSessions.remove(sftpId);
        if (sfc != null) {
            try {
                if (sfc.channel != null && sfc.channel.isConnected()) sfc.channel.disconnect();
            } catch (Exception ignored) {}
            try {
                if (sfc.dedicatedSession != null && sfc.dedicatedSession.isConnected()) {
                    sfc.dedicatedSession.disconnect();
                }
            } catch (Exception ignored) {}
            for (Session js : sfc.jumpSessions) {
                try {
                    if (js != null && js.isConnected()) js.disconnect();
                } catch (Exception ignored) {}
            }
        }
    }

    private void deleteSftpEntryRecursive(ChannelSftp sftp, String remotePath) throws Exception {
        String path = sftp.realpath(remotePath);
        if ("/".equals(path) || remotePath == null || remotePath.trim().isEmpty()) throw new IllegalArgumentException("Refusing to delete root");
        deleteSftpEntryChecked(sftp, remotePath, 0);
    }

    private void deleteSftpEntryChecked(ChannelSftp sftp, String path, int depth) throws Exception {
        if (depth > 128) throw new java.io.IOException("Directory nesting too deep");
        SftpATTRS attrs = sftp.lstat(path);
        if (attrs.isDir() && !attrs.isLink()) {
            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> entries = sftp.ls(path);
            for (ChannelSftp.LsEntry entry : entries) {
                String name = entry.getFilename();
                if (".".equals(name) || "..".equals(name)) continue;
                if (name.indexOf('/') >= 0) throw new java.io.IOException("Invalid directory entry");
                deleteSftpEntryChecked(sftp, path + "/" + name, depth + 1);
            }
            sftp.rmdir(path);
        } else {
            sftp.rm(path);
        }
    }

    private File resolveLocalFile(String rawPath) {
        if (rawPath == null || rawPath.trim().isEmpty() || "~".equals(rawPath.trim()) || ".".equals(rawPath.trim())) {
            return getFilesDir();
        }
        String p = rawPath.trim();
        if (p.startsWith("~/")) {
            return new File(getFilesDir(), p.substring(2));
        }
        return new File(p);
    }

    private static byte[] readAllBytes(InputStream is) throws Exception {
        if (is == null) return new byte[0];
        try (InputStream in = is; ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toByteArray();
        }
    }

    private void emitPortForwardRuntimeSnapshot() {
        try {
            JSONArray arr = new JSONArray();
            for (PortForwardContext pfc : activeForwards.values()) {
                JSONObject item = new JSONObject();
                item.put("tunnelId", pfc.tunnelId);
                item.put("ruleId", pfc.ruleId);
                item.put("type", pfc.type);
                item.put("localPort", pfc.localPort);
                item.put("bindAddress", pfc.bindAddress);
                item.put("remoteHost", pfc.remoteHost);
                item.put("remotePort", pfc.remotePort);
                item.put("status", pfc.status);
                item.put("activeConnections", pfc.activeConnections.get());
                if (pfc.error != null && !pfc.error.isEmpty()) {
                    item.put("error", pfc.error);
                }
                arr.put(item);
            }
            JSONObject payload = new JSONObject();
            payload.put("tunnels", arr);
            emitToJs("port_forward_runtime", payload);
        } catch (Exception ignored) {
        }
    }

    private void startDynamicSocks5Server(final PortForwardContext pfc) throws Exception {
        InetAddress bindInet = (pfc.bindAddress == null || pfc.bindAddress.isEmpty() || "0.0.0.0".equals(pfc.bindAddress))
                ? InetAddress.getByName("0.0.0.0")
                : InetAddress.getByName(pfc.bindAddress);
        final ServerSocket server = new ServerSocket(pfc.localPort, 64, bindInet);
        pfc.dynamicServer = server;
        if (pfc.localPort == 0) {
            pfc.localPort = server.getLocalPort();
        }
        ioPool.execute(new Runnable() {
            @Override
            public void run() {
                while (!server.isClosed() && pfc.session != null && pfc.session.isConnected()) {
                    try {
                        final Socket client = server.accept();
                        client.setTcpNoDelay(true);
                        try { ioPool.execute(new Runnable() {
                            @Override
                            public void run() {
                                handleSocks5Client(pfc, client);
                            }
                        }); } catch (RuntimeException rejected) {
                            try { client.close(); } catch (Exception ignored) {}
                            throw rejected;
                        }
                    } catch (Exception acceptErr) {
                        break;
                    }
                }
            }
        });
    }

    private void handleSocks5Client(final PortForwardContext pfc, final Socket client) {
        ChannelDirectTCPIP channel = null;
        boolean negotiated = false;
        boolean connected = false;
        pfc.activeConnections.incrementAndGet();
        emitPortForwardRuntimeSnapshot();
        try {
            client.setSoTimeout(15000);
            DataInputStream dis = new DataInputStream(client.getInputStream());
            OutputStream cos = client.getOutputStream();

            int ver = dis.readUnsignedByte();
            if (ver != 0x05) {
                client.close();
                return;
            }
            int nMethods = dis.readUnsignedByte();
            byte[] methods = new byte[nMethods];
            dis.readFully(methods);
            boolean supportsNoAuth = false;
            for (byte offered : methods) if (offered == 0) supportsNoAuth = true;
            if (!supportsNoAuth) {
                cos.write(new byte[]{0x05, (byte) 0xff});
                cos.flush();
                return;
            }
            cos.write(new byte[]{0x05, 0x00});
            cos.flush();

            negotiated = true;
            int reqVer = dis.readUnsignedByte();
            int cmd = dis.readUnsignedByte();
            int reserved = dis.readUnsignedByte();
            int atyp = dis.readUnsignedByte();
            if (reqVer != 0x05 || reserved != 0 || cmd != 0x01) {
                cos.write(new byte[]{0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0});
                cos.flush();
                client.close();
                return;
            }

            String targetHost;
            if (atyp == 0x01) {
                byte[] ip4 = new byte[4];
                dis.readFully(ip4);
                targetHost = InetAddress.getByAddress(ip4).getHostAddress();
            } else if (atyp == 0x03) {
                int domainLen = dis.readUnsignedByte();
                if (domainLen == 0) throw new java.io.IOException("Empty SOCKS hostname");
                byte[] domainBytes = new byte[domainLen];
                dis.readFully(domainBytes);
                targetHost = new String(domainBytes, StandardCharsets.US_ASCII);
                if (!targetHost.matches("[A-Za-z0-9._-]+")) throw new java.io.IOException("Invalid SOCKS hostname");
            } else if (atyp == 0x04) {
                byte[] ip6 = new byte[16];
                dis.readFully(ip6);
                targetHost = InetAddress.getByAddress(ip6).getHostAddress();
            } else {
                cos.write(new byte[]{0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0});
                cos.flush();
                client.close();
                return;
            }
            int targetPort = dis.readUnsignedShort();
            if (targetPort == 0) throw new java.io.IOException("Invalid SOCKS port");

            channel = (ChannelDirectTCPIP) pfc.session.openChannel("direct-tcpip");
            channel.setHost(targetHost);
            channel.setPort(targetPort);
            if (client.getInetAddress() != null) {
                channel.setOrgIPAddress(client.getInetAddress().getHostAddress());
            }
            channel.setOrgPort(client.getPort());
            final InputStream remoteIn = channel.getInputStream();
            final OutputStream remoteOut = channel.getOutputStream();
            channel.connect(15000);
            client.setSoTimeout(0);

            // SOCKS5 success reply
            cos.write(new byte[]{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0});
            cos.flush();

            connected = true;
            final ChannelDirectTCPIP finalChannel = channel;
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = remoteIn.read(buf)) != -1) {
                            cos.write(buf, 0, n);
                            cos.flush();
                        }
                    } catch (Exception ignored) {
                    } finally {
                        try { client.close(); } catch (Exception ignored) {}
                        try { finalChannel.disconnect(); } catch (Exception ignored) {}
                    }
                }
            });

            byte[] buf = new byte[16384];
            int n;
            while ((n = dis.read(buf)) != -1) {
                remoteOut.write(buf, 0, n);
                remoteOut.flush();
            }
        } catch (Exception ignored) {
            if (negotiated && !connected) {
                try {
                    client.getOutputStream().write(new byte[]{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0});
                    client.getOutputStream().flush();
                } catch (Exception replyError) {}
            }
        } finally {
            try { if (channel != null) channel.disconnect(); } catch (Exception ignored) {}
            try { client.close(); } catch (Exception ignored) {}
            pfc.activeConnections.decrementAndGet();
            emitPortForwardRuntimeSnapshot();
        }
    }

    private void stopPortForwardInternal(String tunnelId) {
        if (tunnelId == null || tunnelId.isEmpty()) return;
        PortForwardContext pfc = activeForwards.remove(tunnelId);
        if (pfc != null) {
            try {
                if (pfc.dynamicServer != null && !pfc.dynamicServer.isClosed()) {
                    pfc.dynamicServer.close();
                }
            } catch (Exception ignored) {}
            try {
                if (pfc.session != null && pfc.session.isConnected()) {
                    if ("local".equalsIgnoreCase(pfc.type)) {
                        try { pfc.session.delPortForwardingL(pfc.bindAddress, pfc.localPort); } catch (Exception ignored) {}
                    } else if ("remote".equalsIgnoreCase(pfc.type)) {
                        try { pfc.session.delPortForwardingR(pfc.bindAddress, pfc.remotePort); } catch (Exception ignored) {}
                    }
                    pfc.session.disconnect();
                }
            } catch (Exception ignored) {}
            for (Session js : pfc.jumpSessions) {
                try {
                    if (js != null && js.isConnected()) js.disconnect();
                } catch (Exception ignored) {}
            }
        }
    }

    private static byte[] decodeBase32(String input) {
        if (input == null) return new byte[0];
        String clean = input.trim().toUpperCase(Locale.US).replaceAll("[\\s=\\-]", "");
        if (clean.isEmpty()) return new byte[0];
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        int buffer = 0;
        int bitsLeft = 0;
        for (int i = 0; i < clean.length(); i++) {
            int val = alphabet.indexOf(clean.charAt(i));
            if (val < 0) throw new IllegalArgumentException("Invalid Base32 secret");
            buffer = (buffer << 5) | val;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                bitsLeft -= 8;
                baos.write((buffer >> bitsLeft) & 0xFF);
            }
        }
        return baos.toByteArray();
    }

    private static String computeTotpCodeFromUriOrSecret(String uriOrSecret) {
        if (uriOrSecret == null || uriOrSecret.trim().isEmpty()) return "";
        String secret = uriOrSecret.trim();
        String algorithm = "HmacSHA1";
        int digits = 6;
        int period = 30;
        try {
            if (secret.toLowerCase(Locale.US).startsWith("otpauth://")) {
                Uri u = Uri.parse(secret);
                if (!"totp".equalsIgnoreCase(u.getHost())) return "";
                String s = u.getQueryParameter("secret");
                if (s == null || s.isEmpty()) return "";
                secret = s;
                String alg = u.getQueryParameter("algorithm");
                if ("SHA256".equalsIgnoreCase(alg)) algorithm = "HmacSHA256";
                else if ("SHA512".equalsIgnoreCase(alg)) algorithm = "HmacSHA512";
                else if (alg != null && !"SHA1".equalsIgnoreCase(alg)) return "";
                String d = u.getQueryParameter("digits");
                if (d != null) digits = Integer.parseInt(d);
                String p = u.getQueryParameter("period");
                if (p != null) period = Integer.parseInt(p);
            }
            if ((digits != 6 && digits != 8) || period <= 0) return "";
            byte[] keyBytes = decodeBase32(secret);
            if (keyBytes.length == 0) return "";
            long counter = (System.currentTimeMillis() / 1000L) / Math.max(1, period);
            byte[] data = new byte[8];
            for (int i = 7; i >= 0; i--) {
                data[i] = (byte) (counter & 0xFF);
                counter >>= 8;
            }
            Mac mac = Mac.getInstance(algorithm);
            mac.init(new SecretKeySpec(keyBytes, algorithm));
            byte[] hash = mac.doFinal(data);
            int offset = hash[hash.length - 1] & 0x0F;
            int binary = ((hash[offset] & 0x7F) << 24)
                    | ((hash[offset + 1] & 0xFF) << 16)
                    | ((hash[offset + 2] & 0xFF) << 8)
                    | (hash[offset + 3] & 0xFF);
            int mod = 1;
            for (int i = 0; i < digits; i++) mod *= 10;
            int otp = binary % mod;
            return String.format(Locale.US, "%0" + digits + "d", otp);
        } catch (Exception ignored) {
            return "";
        }
    }

    private static class SshUserInfo implements UserInfo, UIKeyboardInteractive {
        private final String password;
        private final String passphrase;
        private final String totpSecret;

        SshUserInfo(String password, String passphrase, String totpSecret) {
            this.password = password != null ? password : "";
            this.passphrase = passphrase != null ? passphrase : "";
            this.totpSecret = totpSecret != null ? totpSecret : "";
        }

        @Override
        public String getPassphrase() {
            return passphrase;
        }

        @Override
        public String getPassword() {
            return password;
        }

        @Override
        public boolean promptPassword(String message) {
            return !password.isEmpty();
        }

        @Override
        public boolean promptPassphrase(String message) {
            return !passphrase.isEmpty();
        }

        @Override
        public boolean promptYesNo(String message) {
            return false;
        }

        @Override
        public void showMessage(String message) {
        }

        @Override
        public String[] promptKeyboardInteractive(String destination, String name, String instruction, String[] prompt, boolean[] echo) {
            if (prompt == null || prompt.length == 0) return new String[0];
            String[] responses = new String[prompt.length];
            for (int i = 0; i < prompt.length; i++) {
                String p = prompt[i] != null ? prompt[i].toLowerCase(Locale.US) : "";
                boolean isOtpPrompt = p.contains("verification") || p.contains("authenticator")
                        || p.contains("totp") || p.contains("otp") || p.contains("token")
                        || p.contains("2fa") || p.contains("two-factor") || p.contains("code")
                        || p.contains("验证码") || p.contains("动态码");
                if (echo != null && i < echo.length && echo[i]) return null;
                if (isOtpPrompt) {
                    String code = computeTotpCodeFromUriOrSecret(totpSecret);
                    if (code.isEmpty()) return null;
                    responses[i] = code;
                } else if (p.contains("password") || p.contains("密码")) {
                    responses[i] = password;
                } else {
                    return null;
                }
            }
            return responses;
        }
    }

    private final Object hostKeyFileLock = new Object();

    /** Only the SSH worker waits; Android UI callbacks never perform SSH or disk I/O. */
    private boolean confirmHostKey(final String host, final com.jcraft.jsch.HostKey key,
                                   final boolean changed) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return false;
        final String fingerprint = "SHA256:" + Base64.encodeToString(
                MessageDigest.getInstance("SHA-256").digest(Base64.decode(key.getKey(), Base64.DEFAULT)),
                Base64.NO_WRAP | Base64.NO_PADDING);
        final java.util.concurrent.CountDownLatch decision = new java.util.concurrent.CountDownLatch(1);
        final java.util.concurrent.atomic.AtomicBoolean accepted = new java.util.concurrent.atomic.AtomicBoolean(false);
        final java.util.concurrent.atomic.AtomicBoolean expired = new java.util.concurrent.atomic.AtomicBoolean(false);
        final AlertDialog[] dialog = new AlertDialog[1];
        mainHandler.post(new Runnable() {
            @Override public void run() {
                if (expired.get() || isFinishing() || isDestroyed()) {
                    decision.countDown();
                    return;
                }
                try {
                    String warning = changed
                            ? "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\n\n"
                              + "This may be a man-in-the-middle attack. Do not continue unless you have independently verified the new fingerprint with your administrator.\n\n"
                            : "This server is not yet trusted. Verify this fingerprint with your administrator before connecting.\n\n";
                    dialog[0] = new AlertDialog.Builder(MainActivity.this)
                            .setTitle(changed ? "SSH host key changed — connection blocked" : "Trust SSH server?")
                            .setMessage(warning + "Host: " + host + "\nKey type: " + key.getType()
                                    + "\nFingerprint: " + fingerprint)
                            .setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface d, int which) { decision.countDown(); }
                            })
                            .setPositiveButton(changed ? "Replace trusted key" : "Trust and connect", new DialogInterface.OnClickListener() {
                                @Override public void onClick(DialogInterface d, int which) {
                                    if (!expired.get()) accepted.set(true);
                                    decision.countDown();
                                }
                            })
                            .setOnCancelListener(new DialogInterface.OnCancelListener() {
                                @Override public void onCancel(DialogInterface d) { decision.countDown(); }
                            }).create();
                    dialog[0].setOnDismissListener(new DialogInterface.OnDismissListener() {
                        @Override public void onDismiss(DialogInterface d) { decision.countDown(); }
                    });
                    dialog[0].setCanceledOnTouchOutside(false);
                    dialog[0].show();
                    // Keyboard/DPAD Enter defaults to the safe action, especially on changed keys.
                    dialog[0].getButton(AlertDialog.BUTTON_NEGATIVE).requestFocus();
                } catch (RuntimeException e) {
                    decision.countDown();
                }
            }
        });
        try {
            return decision.await(90, java.util.concurrent.TimeUnit.SECONDS) && accepted.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            expired.set(true);
            mainHandler.post(new Runnable() {
                @Override public void run() { if (dialog[0] != null) dialog[0].dismiss(); }
            });
        }
    }

    private final class ConfirmingHostKeyRepository implements com.jcraft.jsch.HostKeyRepository {
        private final File file;
        private com.jcraft.jsch.HostKeyRepository delegate;

        ConfirmingHostKeyRepository(JSch owner, File file) {
            this.file = file;
            this.delegate = owner.getHostKeyRepository();
        }

        private void reload() throws Exception {
            // Fresh repository avoids overwriting another concurrently confirmed server's key.
            JSch reader = new JSch();
            reader.setKnownHosts(file.getAbsolutePath());
            delegate = reader.getHostKeyRepository();
        }

        @Override public int check(String host, byte[] keyBytes) {
            if (Looper.myLooper() == Looper.getMainLooper()) return NOT_INCLUDED;
            try {
                final int initial;
                synchronized (hostKeyFileLock) {
                    reload();
                    initial = delegate.check(host, keyBytes);
                }
                if (initial == OK) return OK;
                if (initial != NOT_INCLUDED && initial != CHANGED) return initial;
                com.jcraft.jsch.HostKey key = new com.jcraft.jsch.HostKey(host, keyBytes);
                if (!confirmHostKey(host, key, initial == CHANGED)) return initial;
                synchronized (hostKeyFileLock) {
                    reload();
                    int current = delegate.check(host, keyBytes);
                    if (current == OK) return OK;
                    // A key changed while the first-connect prompt was open: require a new warning.
                    if (current != initial) return current;
                    if (current == CHANGED) delegate.remove(host, key.getType());
                    delegate.add(key, null);
                    // JSch add() can swallow file-write errors: require persisted trust before auth.
                    reload();
                    return delegate.check(host, keyBytes) == OK ? OK : NOT_INCLUDED;
                }
            } catch (Exception e) {
                return NOT_INCLUDED;
            }
        }

        @Override public void add(com.jcraft.jsch.HostKey key, UserInfo info) {
            // JSch must not bypass the explicit confirmation performed in check().
        }
        @Override public void remove(String host, String type) { }
        @Override public void remove(String host, String type, byte[] key) { }
        @Override public String getKnownHostsRepositoryID() { return file.getAbsolutePath(); }
        @Override public com.jcraft.jsch.HostKey[] getHostKey() { return delegate.getHostKey(); }
        @Override public com.jcraft.jsch.HostKey[] getHostKey(String host, String type) {
            return delegate.getHostKey(host, type);
        }
    }

    private Session dialSingleJschSession(JSONObject cfg, String overrideHost, int overridePort) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new IllegalStateException("SSH connections must run on a worker thread");
        }
        String hostname = (overrideHost != null && !overrideHost.isEmpty())
                ? overrideHost
                : cfg.optString("hostname", "").trim();
        if (hostname.isEmpty()) {
            hostname = cfg.optString("host", cfg.optString("sshHost", "")).trim();
        }
        int port = (overridePort > 0) ? overridePort : cfg.optInt("port", cfg.optInt("sshPort", 22));
        String username = cfg.optString("username", "root").trim();
        if (username.isEmpty()) username = "root";
        String password = cfg.optString("password", "");
        String privateKey = cfg.optString("privateKey", "").trim();
        String privateKeyPath = cfg.optString("privateKeyPath", "").trim();
        String certificate = cfg.optString("certificate", "").trim();
        String passphrase = cfg.optString("passphrase", "");
        String totpSecret = cfg.optString("totpUri", cfg.optString("totpSecret", "")).trim();
        boolean legacyAlgorithms = cfg.optBoolean("legacyAlgorithms", false);

        if (hostname.isEmpty()) {
            throw new IllegalArgumentException("SSH hostname is empty");
        }

        JSch jsch = new JSch();
        if (privateKey.isEmpty() && !privateKeyPath.isEmpty()) {
            File kf = resolveLocalFile(privateKeyPath);
            if (kf.exists() && kf.isFile()) {
                byte[] kb = readAllBytes(new FileInputStream(kf));
                privateKey = new String(kb, StandardCharsets.UTF_8).trim();
            }
        }
        if (!privateKey.isEmpty()) {
            String normalizedKey = privateKey.replace("\r\n", "\n").trim() + "\n";
            byte[] prvBytes = normalizedKey.getBytes(StandardCharsets.UTF_8);
            byte[] pubBytes = (!certificate.isEmpty())
                    ? (certificate.replace("\r\n", "\n").trim() + "\n").getBytes(StandardCharsets.UTF_8)
                    : null;
            byte[] passBytes = passphrase.isEmpty() ? null : passphrase.getBytes(StandardCharsets.UTF_8);
            jsch.addIdentity("nc-key-" + System.nanoTime(), prvBytes, pubBytes, passBytes);
        }

        Session session = jsch.getSession(username, hostname, port);
        if (!password.isEmpty()) {
            session.setPassword(password);
        }
        session.setUserInfo(new SshUserInfo(password, passphrase, totpSecret));

        // Optional HTTP / SOCKS5 proxy support
        JSONObject proxyCfg = cfg.optJSONObject("proxyConfig");
        if (proxyCfg == null) proxyCfg = cfg.optJSONObject("proxy");
        if (proxyCfg != null && overrideHost == null) {
            String pType = proxyCfg.optString("type", "").toLowerCase(Locale.US);
            String pHost = proxyCfg.optString("host", proxyCfg.optString("hostname", "")).trim();
            int pPort = proxyCfg.optInt("port", 0);
            String pUser = proxyCfg.optString("username", "").trim();
            String pPass = proxyCfg.optString("password", "");
            if (!pHost.isEmpty() && pPort > 0) {
                if ("http".equals(pType) || "https".equals(pType)) {
                    ProxyHTTP proxy = new ProxyHTTP(pHost, pPort);
                    if (!pUser.isEmpty()) proxy.setUserPasswd(pUser, pPass);
                    session.setProxy(proxy);
                } else if (pType.startsWith("socks")) {
                    ProxySOCKS5 proxy = new ProxySOCKS5(pHost, pPort);
                    if (!pUser.isEmpty()) proxy.setUserPasswd(pUser, pPass);
                    session.setProxy(proxy);
                }
            }
        }

        Properties config = new Properties();
        // Trust uses the real destination, never a loopback endpoint used by jump forwarding.
        String originalHost = cfg.optString("hostname", "").trim();
        if (originalHost.isEmpty()) originalHost = cfg.optString("host", cfg.optString("sshHost", hostname)).trim();
        int originalPort = cfg.optInt("port", cfg.optInt("sshPort", 22));
        String alias = originalPort == 22 ? originalHost : "[" + originalHost + "]:" + originalPort;
        File knownHostsFile = new File(new File(getFilesDir(), ".ssh"), "known_hosts");
        synchronized (hostKeyFileLock) {
            File sshDirectory = knownHostsFile.getParentFile();
            if (!sshDirectory.isDirectory() && !sshDirectory.mkdirs()) {
                throw new java.io.IOException("Cannot create SSH trust directory");
            }
            if (!knownHostsFile.exists() && !knownHostsFile.createNewFile()) {
                throw new java.io.IOException("Cannot create SSH known_hosts");
            }
            jsch.setKnownHosts(knownHostsFile.getAbsolutePath());
            JSONArray trustedHosts = cfg.optJSONArray("knownHosts");
            if (trustedHosts != null) {
                for (int i = 0; i < trustedHosts.length(); i++) {
                    JSONObject trusted = trustedHosts.optJSONObject(i);
                    if (trusted == null) continue;
                    // domain/models/history.ts KnownHost: hostname, port, keyType, publicKey.
                    String trustedName = trusted.optString("hostname", "").trim();
                    if ((!trustedName.equals(originalHost) && !trustedName.equals(alias))
                            || trusted.optInt("port", 22) != originalPort) continue;
                    try {
                        String publicKey = trusted.optString("publicKey", "").trim();
                        String keyType = trusted.optString("keyType", "");
                        // Fingerprint-only records are not usable public keys; prompt instead.
                        if (publicKey.isEmpty() || publicKey.startsWith("SHA256:") || publicKey.startsWith("MD5:")) continue;
                        String[] fields = publicKey.split("\\s+");
                        byte[] keyBytes = Base64.decode(fields.length >= 2 ? fields[1] : fields[0], Base64.DEFAULT);
                        com.jcraft.jsch.HostKey trustedKey = new com.jcraft.jsch.HostKey(alias, keyBytes);
                        if (!trustedKey.getType().equals(keyType)) continue;
                        com.jcraft.jsch.HostKeyRepository repository = jsch.getHostKeyRepository();
                        // Local confirmed keys take precedence over stale imported trust records.
                        if (repository.getHostKey(alias, trustedKey.getType()).length == 0) repository.add(trustedKey, null);
                    } catch (Exception invalidRecord) {
                        // Malformed imports cannot disable first-connect confirmation.
                    }
                }
            }
            jsch.setHostKeyRepository(new ConfirmingHostKeyRepository(jsch, knownHostsFile));
        }
        session.setHostKeyAlias(alias);
        config.put("StrictHostKeyChecking", "yes");
        config.put("PreferredAuthentications", "publickey,keyboard-interactive,password");
        if (legacyAlgorithms) {
            config.put("PubkeyAcceptedAlgorithms",
                    "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss");
            config.put("server_host_key",
                    "ssh-ed25519,ecdsa-sha2-nistp256,ecdsa-sha2-nistp384,ecdsa-sha2-nistp521,rsa-sha2-512,rsa-sha2-256,ssh-rsa,ssh-dss");
            config.put("kex",
                    "curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,diffie-hellman-group-exchange-sha256,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,diffie-hellman-group14-sha256,diffie-hellman-group14-sha1,diffie-hellman-group1-sha1");
        }
        session.setConfig(config);
        int keepaliveSec = cfg.optInt("keepaliveInterval", 25);
        session.setServerAliveInterval(Math.max(10, keepaliveSec) * 1000);
        session.setServerAliveCountMax(cfg.optInt("keepaliveCountMax", 3));
        session.connect(15000);
        return session;
    }

    private SshContext createConnectedSshContext(JSONObject cfg) throws Exception {
        SshContext ctx = new SshContext();
        ctx.sessionId = cfg.optString("sessionId", "");
        ctx.hostId = cfg.optString("hostId", "");
        ctx.hostname = cfg.optString("hostname", "").trim();
        ctx.port = cfg.optInt("port", 22);
        ctx.username = cfg.optString("username", "root").trim();
        ctx.rawOptions = cfg;

        // Support both jumpHosts array (Netcatty standard) and single jumpHost object
        JSONArray jumpArr = cfg.optJSONArray("jumpHosts");
        if (jumpArr == null || jumpArr.length() == 0) {
            JSONObject singleJump = cfg.optJSONObject("jumpHost");
            if (singleJump != null && !singleJump.optString("hostname", "").trim().isEmpty()) {
                jumpArr = new JSONArray();
                jumpArr.put(singleJump);
            }
        }

        if (jumpArr != null && jumpArr.length() > 0) {
            String currentForwardHost = null;
            int currentForwardPort = 0;
            for (int i = 0; i < jumpArr.length(); i++) {
                JSONObject hopCfg = jumpArr.getJSONObject(i);
                Session hopSession = dialSingleJschSession(hopCfg, currentForwardHost, currentForwardPort);
                ctx.jumpSessions.add(hopSession);

                String nextHost = (i + 1 < jumpArr.length())
                        ? jumpArr.getJSONObject(i + 1).optString("hostname", "").trim()
                        : ctx.hostname;
                int nextPort = (i + 1 < jumpArr.length())
                        ? jumpArr.getJSONObject(i + 1).optInt("port", 22)
                        : ctx.port;
                currentForwardPort = hopSession.setPortForwardingL(0, nextHost, nextPort);
                currentForwardHost = "127.0.0.1";
            }
            ctx.session = dialSingleJschSession(cfg, currentForwardHost, currentForwardPort);
        } else {
            ctx.session = dialSingleJschSession(cfg, null, 0);
        }
        return ctx;
    }

    private String execCommandOnJschSession(Session session, String command, int timeoutMs) throws Exception {
        ChannelExec exec = null;
        try {
            exec = (ChannelExec) session.openChannel("exec");
            exec.setCommand(command);
            ByteArrayOutputStream outBuf = new ByteArrayOutputStream();
            ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
            exec.setOutputStream(outBuf);
            exec.setErrStream(errBuf);
            exec.connect(Math.min(10000, Math.max(3000, timeoutMs)));

            long waitStart = System.currentTimeMillis();
            while (!exec.isClosed() && (System.currentTimeMillis() - waitStart) < timeoutMs) {
                Thread.sleep(35);
            }
            return new String(outBuf.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            if (exec != null) {
                try { exec.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private JSONObject execFullOnJschSession(Session session, String command, int timeoutMs, String stdinData) throws Exception {
        ChannelExec exec = null;
        try {
            exec = (ChannelExec) session.openChannel("exec");
            exec.setCommand(command);
            ByteArrayOutputStream outBuf = new ByteArrayOutputStream();
            ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
            exec.setOutputStream(outBuf);
            exec.setErrStream(errBuf);
            OutputStream inStream = (stdinData != null && !stdinData.isEmpty()) ? exec.getOutputStream() : null;
            exec.connect(Math.min(10000, Math.max(3000, timeoutMs)));
            if (inStream != null) {
                try {
                    inStream.write(stdinData.getBytes(StandardCharsets.UTF_8));
                    inStream.flush();
                    inStream.close();
                } catch (Exception ignored) {}
            }

            long waitStart = System.currentTimeMillis();
            while (!exec.isClosed() && (System.currentTimeMillis() - waitStart) < timeoutMs) {
                Thread.sleep(35);
            }
            JSONObject res = new JSONObject();
            res.put("success", true);
            res.put("stdout", new String(outBuf.toByteArray(), StandardCharsets.UTF_8));
            res.put("stderr", new String(errBuf.toByteArray(), StandardCharsets.UTF_8));
            res.put("exitCode", exec.getExitStatus());
            res.put("code", exec.getExitStatus());
            return res;
        } finally {
            if (exec != null) {
                try { exec.disconnect(); } catch (Exception ignored) {}
            }
        }
    }

    private JSONObject collectLinuxServerStats(SshContext sc) throws Exception {
        long t0 = System.currentTimeMillis();
        String cmd = "export LC_ALL=C; "
                + "cores=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1); "
                + "cpuraw=$(awk '/^cpu / {total=0; for(i=2;i<=NF;i++) total+=$i; printf \"%d %d\", total, $5}' /proc/stat 2>/dev/null); "
                + "meminfo=$(awk '/^MemTotal:/{t=$2} /^MemFree:/{f=$2} /^Buffers:/{b=$2} /^Cached:/{c=$2} /^SReclaimable:/{s=$2} /^SwapTotal:/{st=$2} /^SwapFree:/{sf=$2} END{printf \"%d %d %d %d %d %d\", t/1024, f/1024, b/1024, (c+s)/1024, st/1024, sf/1024}' /proc/meminfo 2>/dev/null); "
                + "disks=$(df -kP 2>/dev/null | awk 'NR>1 && $1 !~ /^(tmpfs|devtmpfs|udev|none|overlay|shm)/ {t=$2/1048576; u=$3/1048576; p=$5; gsub(/%/,\"\",p); if(t>0) printf \"%s:%.2f:%.2f:%s,\", $6, u, t, p}' | sed 's/,$//'); "
                + "net=$(cat /proc/net/dev 2>/dev/null | awk 'NR>2 {gsub(/^[ \\t]+/,\"\"); split($0,a,\":\"); iface=a[1]; if(iface!=\"lo\" && iface!~/^veth/ && iface!~/^docker/ && iface!~/^br-/){split(a[2],b); printf \"%s:%s:%s,\", iface, b[1], b[9]}}' | sed 's/,$//'); "
                + "host=$(hostname 2>/dev/null || uname -n 2>/dev/null); "
                + "os=$(awk -F= '/^PRETTY_NAME=/{gsub(/\"/,\"\",$2);print $2;exit}' /etc/os-release 2>/dev/null || uname -s 2>/dev/null); "
                + "kern=$(uname -r 2>/dev/null); "
                + "up=$(awk '{printf \"%.0f\",$1}' /proc/uptime 2>/dev/null); "
                + "load=$(awk '{print $1\" \"$2\" \"$3}' /proc/loadavg 2>/dev/null); "
                + "procs=$(ps -eo pid,%mem,comm --sort=-%mem 2>/dev/null | awk 'NR>1 && NR<=11 {gsub(/;/,\"_\",$3); printf \"%s;%.1f;%s,\", $1, $2, $3}' | sed 's/,$//'); "
                + "echo \"CORES:$cores|CPURAW:$cpuraw|MEMINFO:$meminfo|DISKS:$disks|NET:$net|HOST:$host|OS:$os|KERNEL:$kern|UPTIME:$up|LOAD:$load|PROCS:$procs\"";

        String out = execCommandOnJschSession(sc.session, cmd, 8000).trim();
        long latencyMs = System.currentTimeMillis() - t0;

        int cpuCores = 1;
        long cpuTotal = 0;
        long cpuIdle = 0;
        long memTotal = 0, memFree = 0, memBuffers = 0, memCached = 0, swapTotal = 0, swapFree = 0;
        String hostname = sc.hostname;
        String osName = "Linux";
        String kernelRelease = "";
        long uptimeSeconds = 0;
        JSONArray loadAverage = new JSONArray();
        JSONArray disksArr = new JSONArray();
        JSONArray topProcsArr = new JSONArray();
        List<String[]> netParsed = new ArrayList<>();

        String[] parts = out.split("\\|");
        for (String part : parts) {
            if (part.startsWith("CORES:")) {
                try { cpuCores = Math.max(1, Integer.parseInt(part.substring(6).trim())); } catch (Exception ignored) {}
            } else if (part.startsWith("CPURAW:")) {
                String[] cr = part.substring(7).trim().split("\\s+");
                if (cr.length >= 2) {
                    try {
                        cpuTotal = Long.parseLong(cr[0]);
                        cpuIdle = Long.parseLong(cr[1]);
                    } catch (Exception ignored) {}
                }
            } else if (part.startsWith("MEMINFO:")) {
                String[] mr = part.substring(8).trim().split("\\s+");
                if (mr.length >= 6) {
                    try {
                        memTotal = Long.parseLong(mr[0]);
                        memFree = Long.parseLong(mr[1]);
                        memBuffers = Long.parseLong(mr[2]);
                        memCached = Long.parseLong(mr[3]);
                        swapTotal = Long.parseLong(mr[4]);
                        swapFree = Long.parseLong(mr[5]);
                    } catch (Exception ignored) {}
                }
            } else if (part.startsWith("DISKS:")) {
                String ds = part.substring(6).trim();
                if (!ds.isEmpty()) {
                    for (String item : ds.split(",")) {
                        String[] dp = item.split(":");
                        if (dp.length >= 4) {
                            try {
                                JSONObject dObj = new JSONObject();
                                dObj.put("mountPoint", dp[0]);
                                dObj.put("used", Double.parseDouble(dp[1]));
                                dObj.put("total", Double.parseDouble(dp[2]));
                                dObj.put("percent", Integer.parseInt(dp[3].replaceAll("[^0-9]", "")));
                                disksArr.put(dObj);
                            } catch (Exception ignored) {}
                        }
                    }
                }
            } else if (part.startsWith("NET:")) {
                String ns = part.substring(4).trim();
                if (!ns.isEmpty()) {
                    for (String item : ns.split(",")) {
                        String[] np = item.split(":");
                        if (np.length >= 3) {
                            netParsed.add(np);
                        }
                    }
                }
            } else if (part.startsWith("HOST:")) {
                String h = part.substring(5).trim();
                if (!h.isEmpty()) hostname = h;
            } else if (part.startsWith("OS:")) {
                String o = part.substring(3).trim();
                if (!o.isEmpty()) osName = o;
            } else if (part.startsWith("KERNEL:")) {
                kernelRelease = part.substring(7).trim();
            } else if (part.startsWith("UPTIME:")) {
                try { uptimeSeconds = Long.parseLong(part.substring(7).trim()); } catch (Exception ignored) {}
            } else if (part.startsWith("LOAD:")) {
                for (String lv : part.substring(5).trim().split("\\s+")) {
                    try { loadAverage.put(Double.parseDouble(lv)); } catch (Exception ignored) {}
                }
            } else if (part.startsWith("PROCS:")) {
                String ps = part.substring(6).trim();
                if (!ps.isEmpty()) {
                    for (String pe : ps.split(",")) {
                        String[] pp = pe.split(";");
                        if (pp.length >= 3) {
                            try {
                                JSONObject pObj = new JSONObject();
                                pObj.put("pid", pp[0]);
                                pObj.put("memPercent", Double.parseDouble(pp[1]));
                                pObj.put("command", pp[2]);
                                topProcsArr.put(pObj);
                            } catch (Exception ignored) {}
                        }
                    }
                }
            }
        }

        int cpuPct = 0;
        if (cpuTotal > 0 && sc.prevCpuTotal > 0) {
            long totalDelta = cpuTotal - sc.prevCpuTotal;
            long idleDelta = cpuIdle - sc.prevCpuIdle;
            if (totalDelta > 0) {
                cpuPct = (int) Math.max(0, Math.min(100, Math.round(100.0 - (idleDelta * 100.0 / totalDelta))));
            }
        }
        sc.prevCpuTotal = cpuTotal;
        sc.prevCpuIdle = cpuIdle;

        long now = System.currentTimeMillis();
        double dt = sc.prevNetTime > 0 ? (now - sc.prevNetTime) / 1000.0 : 0;
        long totalRxSpeed = 0;
        long totalTxSpeed = 0;
        JSONArray netIfacesArr = new JSONArray();
        for (String[] np : netParsed) {
            try {
                String ifName = np[0];
                long rx = Long.parseLong(np[1]);
                long tx = Long.parseLong(np[2]);
                long rxSpd = 0;
                long txSpd = 0;
                long[] prev = sc.prevNetIfaces.get(ifName);
                if (prev != null && dt > 0) {
                    rxSpd = Math.max(0, Math.round((rx - prev[0]) / dt));
                    txSpd = Math.max(0, Math.round((tx - prev[1]) / dt));
                }
                sc.prevNetIfaces.put(ifName, new long[]{rx, tx});
                totalRxSpeed += rxSpd;
                totalTxSpeed += txSpd;
                JSONObject ifObj = new JSONObject();
                ifObj.put("name", ifName);
                ifObj.put("rxBytes", rx);
                ifObj.put("txBytes", tx);
                ifObj.put("rxSpeed", rxSpd);
                ifObj.put("txSpeed", txSpd);
                netIfacesArr.put(ifObj);
            } catch (Exception ignored) {}
        }
        sc.prevNetTime = now;

        long memUsed = Math.max(0, memTotal - memFree - memBuffers - memCached);
        long swapUsed = Math.max(0, swapTotal - swapFree);

        double rootUsed = 0, rootTotal = 0;
        int rootPct = 0;
        for (int i = 0; i < disksArr.length(); i++) {
            JSONObject d = disksArr.getJSONObject(i);
            if ("/".equals(d.optString("mountPoint")) || i == 0) {
                rootUsed = d.optDouble("used", 0);
                rootTotal = d.optDouble("total", 0);
                rootPct = d.optInt("percent", 0);
                if ("/".equals(d.optString("mountPoint"))) break;
            }
        }

        JSONObject stats = new JSONObject();
        stats.put("cpu", cpuPct);
        stats.put("cpuCores", cpuCores);
        stats.put("cpuPerCore", new JSONArray());
        stats.put("memTotal", memTotal);
        stats.put("memUsed", memUsed);
        stats.put("memFree", memFree);
        stats.put("memBuffers", memBuffers);
        stats.put("memCached", memCached);
        stats.put("swapTotal", swapTotal);
        stats.put("swapUsed", swapUsed);
        stats.put("topProcesses", topProcsArr);
        stats.put("diskPercent", rootPct);
        stats.put("diskUsed", rootUsed);
        stats.put("diskTotal", rootTotal);
        stats.put("disks", disksArr);
        stats.put("networkReady", dt > 0);
        stats.put("netRxSpeed", totalRxSpeed);
        stats.put("netTxSpeed", totalTxSpeed);
        stats.put("latencyMs", latencyMs);
        stats.put("responseLatencyMs", latencyMs);
        stats.put("netInterfaces", netIfacesArr);
        stats.put("hostname", hostname);
        stats.put("osName", osName);
        stats.put("kernelRelease", kernelRelease);
        stats.put("uptimeSeconds", uptimeSeconds);
        stats.put("loadAverage", loadAverage);

        JSONObject res = new JSONObject();
        res.put("success", true);
        res.put("stats", stats);
        return res;
    }

    private boolean deleteRecursively(File f) {
        if (f == null || !f.exists()) return true;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) {
                    deleteRecursively(c);
                }
            }
        }
        return f.delete();
    }

    private static String readHttpLine(InputStream in) throws Exception {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int prev = -1;
        int c;
        while ((c = in.read()) != -1) {
            if (prev == '\r' && c == '\n') {
                byte[] arr = line.toByteArray();
                return new String(arr, 0, Math.max(0, arr.length - 1), StandardCharsets.ISO_8859_1);
            }
            line.write(c);
            prev = c;
        }
        if (line.size() == 0) return null;
        return new String(line.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private JSONObject executeRawHttpSocketRequest(String urlStr, String method, JSONObject hdrs, String bodyStr, boolean skipTlsVerify, int redirectsLeft) throws Exception {
        URL url = new URL(urlStr);
        boolean isHttps = "https".equalsIgnoreCase(url.getProtocol());
        if (!isHttps && !"http".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("Only HTTP(S) URLs are supported");
        if (!method.matches("[A-Z]+")) throw new IllegalArgumentException("Invalid HTTP method");
        String host = url.getHost();
        int port = url.getPort() > 0 ? url.getPort() : (isHttps ? 443 : 80);
        String path = url.getFile();
        if (path == null || path.isEmpty()) path = "/";
        if (path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0 || path.indexOf(' ') >= 0) throw new IllegalArgumentException("Invalid HTTP path");

        Socket sock = new Socket();
        try {
            sock.connect(new InetSocketAddress(host, port), 15000);
            sock.setSoTimeout(30000);
            if (isHttps) {
                SSLContext sc = SSLContext.getInstance("TLS");
                if (skipTlsVerify) {
                    TrustManager[] trustAll = new TrustManager[]{new X509TrustManager() {
                        @Override public void checkClientTrusted(X509Certificate[] c, String a) {}
                        @Override public void checkServerTrusted(X509Certificate[] c, String a) {}
                        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    }};
                    sc.init(null, trustAll, new java.security.SecureRandom());
                } else {
                    sc.init(null, null, null);
                }
                javax.net.ssl.SSLSocket tls = (javax.net.ssl.SSLSocket) sc.getSocketFactory().createSocket(sock, host, port, true);
                sock = tls;
                tls.setSoTimeout(30000);
                if (!skipTlsVerify) {
                    javax.net.ssl.SSLParameters parameters = tls.getSSLParameters();
                    parameters.setEndpointIdentificationAlgorithm("HTTPS");
                    tls.setSSLParameters(parameters);
                }
                tls.startHandshake();
            }
        } catch (Exception e) {
            try { sock.close(); } catch (Exception ignored) {}
            throw e;
        }

        try (Socket autoClose = sock) {
            OutputStream os = autoClose.getOutputStream();
            InputStream is = autoClose.getInputStream();
            byte[] bodyBytes = (bodyStr != null && !bodyStr.isEmpty()) ? bodyStr.getBytes(StandardCharsets.UTF_8) : new byte[0];

            StringBuilder req = new StringBuilder();
            req.append(method).append(" ").append(path).append(" HTTP/1.1\r\n");
            boolean hasHost = false;
            boolean hasConn = false;
            boolean hasLen = false;
            if (hdrs != null) {
                JSONArray names = hdrs.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String k = names.getString(i);
                        String v = hdrs.optString(k, "");
                        if (!k.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") || v.indexOf('\r') >= 0 || v.indexOf('\n') >= 0) throw new IllegalArgumentException("Invalid HTTP header");
                        if (k.equalsIgnoreCase("Host")) hasHost = true;
                        if (k.equalsIgnoreCase("Connection")) hasConn = true;
                        if (k.equalsIgnoreCase("Content-Length")) hasLen = true;
                        if (!v.isEmpty()) {
                            req.append(k).append(": ").append(v).append("\r\n");
                        }
                    }
                }
            }
            if (!hasHost) {
                String hostHeader = (url.getPort() > 0 && url.getPort() != 80 && url.getPort() != 443)
                        ? (host + ":" + port) : host;
                req.append("Host: ").append(hostHeader).append("\r\n");
            }
            if (!hasConn) {
                req.append("Connection: close\r\n");
            }
            if (!hasLen && bodyBytes.length > 0) {
                req.append("Content-Length: ").append(bodyBytes.length).append("\r\n");
            }
            req.append("\r\n");

            os.write(req.toString().getBytes(StandardCharsets.UTF_8));
            if (bodyBytes.length > 0) {
                os.write(bodyBytes);
            }
            os.flush();

            String statusLine = readHttpLine(is);
            if (statusLine == null) {
                throw new IllegalStateException("Empty HTTP response");
            }
            int status = 0;
            String[] statusParts = statusLine.split(" ", 3);
            if (statusParts.length >= 2) {
                try { status = Integer.parseInt(statusParts[1].trim()); } catch (Exception ignored) {}
            }

            JSONObject respHeaders = new JSONObject();
            int contentLength = -1;
            boolean chunked = false;
            String location = null;
            String line;
            while ((line = readHttpLine(is)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String hk = line.substring(0, colon).trim();
                    String hv = line.substring(colon + 1).trim();
                    respHeaders.put(hk.toLowerCase(Locale.US), hv);
                    if ("content-length".equalsIgnoreCase(hk)) {
                        try { contentLength = Integer.parseInt(hv); } catch (Exception ignored) {}
                    } else if ("transfer-encoding".equalsIgnoreCase(hk) && hv.toLowerCase(Locale.US).contains("chunked")) {
                        chunked = true;
                    } else if ("location".equalsIgnoreCase(hk)) {
                        location = hv;
                    }
                }
            }

            ByteArrayOutputStream respBody = new ByteArrayOutputStream();
            if (!"HEAD".equalsIgnoreCase(method) && status != 204 && status != 304) {
                if (chunked) {
                    while (true) {
                        String sizeLine = readHttpLine(is);
                        if (sizeLine == null) throw new java.io.EOFException("Truncated HTTP chunks");
                        int semi = sizeLine.indexOf(';');
                        String hex = (semi >= 0 ? sizeLine.substring(0, semi) : sizeLine).trim();
                        if (hex.isEmpty()) continue;
                        int chunkSize = Integer.parseInt(hex, 16);
                        if (chunkSize <= 0) {
                            readHttpLine(is);
                            break;
                        }
                        byte[] chunkBuf = new byte[Math.min(chunkSize, 16384)];
                        int remaining = chunkSize;
                        while (remaining > 0) {
                            int r = is.read(chunkBuf, 0, Math.min(chunkBuf.length, remaining));
                            if (r == -1) throw new java.io.EOFException("Truncated HTTP body");
                            respBody.write(chunkBuf, 0, r);
                            remaining -= r;
                        }
                        readHttpLine(is); // consume CRLF after chunk
                    }
                } else if (contentLength >= 0) {
                    byte[] buf = new byte[8192];
                    int remaining = contentLength;
                    while (remaining > 0) {
                        int r = is.read(buf, 0, Math.min(buf.length, remaining));
                        if (r == -1) throw new java.io.EOFException("Truncated HTTP body");
                        respBody.write(buf, 0, r);
                        remaining -= r;
                    }
                } else {
                    byte[] buf = new byte[8192];
                    int r;
                    while ((r = is.read(buf)) != -1) {
                        respBody.write(buf, 0, r);
                    }
                }
            }

            JSONObject out = new JSONObject();
            out.put("ok", status >= 200 && status < 300);
            out.put("status", status);
            out.put("headers", respHeaders);
            out.put("data", new String(respBody.toByteArray(), StandardCharsets.UTF_8));
            return out;
        }
    }

    private HttpURLConnection openHttpConnection(String urlStr, String method, boolean skipTlsVerify) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        if (conn instanceof HttpsURLConnection && skipTlsVerify) {
            HttpsURLConnection https = (HttpsURLConnection) conn;
            TrustManager[] trustAll = new TrustManager[]{
                new X509TrustManager() {
                    @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                    @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                    @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                }
            };
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, trustAll, new java.security.SecureRandom());
            https.setSSLSocketFactory(sc.getSocketFactory());
            https.setHostnameVerifier(new HostnameVerifier() {
                @Override public boolean verify(String hostname, SSLSession session) { return true; }
            });
        }
        conn.setRequestMethod(method);
        // Never let the platform replay credentials or request bodies on redirects.
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        return conn;
    }

    public class NetcattyNativeBridge {

        @JavascriptInterface
        public boolean credentialsAvailable() {
            return CredentialCipher.available();
        }

        @JavascriptInterface
        public String credentialsEncrypt(String plaintext) {
            try { return CredentialCipher.encrypt(plaintext); }
            catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String credentialsDecrypt(String ciphertext) {
            try { return CredentialCipher.decrypt(ciphertext); }
            catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public String getDeviceSysInfo() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                obj.put("androidRelease", Build.VERSION.RELEASE);
                obj.put("sdkInt", Build.VERSION.SDK_INT);
                obj.put("abi", Build.SUPPORTED_ABIS != null && Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "arm64-v8a");
                obj.put("cores", Runtime.getRuntime().availableProcessors());
                File dataDir = getFilesDir();
                obj.put("freeSpaceMb", dataDir.getFreeSpace() / (1024 * 1024));
                obj.put("totalSpaceMb", dataDir.getTotalSpace() / (1024 * 1024));
                obj.put("filesDir", dataDir.getAbsolutePath());
                return obj.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void vibrateShort() {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null && v.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(14, VibrationEffect.DEFAULT_AMPLITUDE));
                    } else {
                        v.vibrate(14);
                    }
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            openExternalUrl(url);
        }

        @JavascriptInterface
        public void requestOpenFilePicker(final String callbackId) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        pendingImportCallbackId = callbackId;
                        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType("*/*");
                        startActivityForResult(intent, REQ_IMPORT_FILE);
                    } catch (Exception e) {
                        pendingImportCallbackId = null;
                        try {
                            JSONObject ev = new JSONObject();
                            ev.put("callbackId", callbackId);
                            ev.put("canceled", true);
                            ev.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("dialog:open-file-result", ev);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void setStatusBarColorHex(final String hexColor) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        Window window = getWindow();
                        if (window != null && hexColor != null && hexColor.startsWith("#")) {
                            int color = Color.parseColor(hexColor);
                            window.setStatusBarColor(color);
                            window.setNavigationBarColor(color);
                        }
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void copyToClipboard(String text) {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("Netcatty", text));
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip() != null && cm.getPrimaryClip().getItemCount() > 0) {
                    CharSequence cs = cm.getPrimaryClip().getItemAt(0).getText();
                    return cs != null ? cs.toString() : "";
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        // =====================================================================
        // 1. REAL SSHv2 PTY Shell Session (JSch + BouncyCastle + xterm-256color)
        // =====================================================================
        @JavascriptInterface
        public void connectSshSession(final String reqId, final String jsonConfig) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    String sessionId = "";
                    long t0 = System.currentTimeMillis();
                    try {
                        JSONObject cfg = new JSONObject(jsonConfig);
                        sessionId = cfg.optString("sessionId", "");
                        int cols = Math.max(20, cfg.optInt("cols", 80));
                        int rows = Math.max(8, cfg.optInt("rows", 24));
                        String startupCmd = cfg.optString("startupCommand", "").trim();

                        closeSessionInternal(sessionId);

                        SshContext ctx = createConnectedSshContext(cfg);
                        long rttMs = System.currentTimeMillis() - t0;

                        ChannelShell channel = (ChannelShell) ctx.session.openChannel("shell");
                        channel.setPtyType("xterm-256color", cols, rows, cols * 8, rows * 16);
                        channel.setEnv("LANG", "en_US.UTF-8");
                        InputStream is = channel.getInputStream();
                        OutputStream os = channel.getOutputStream();
                        channel.connect(15000);

                        ctx.shellChannel = channel;
                        ctx.shellOut = os;
                        sshSessions.put(sessionId, ctx);

                        JSONObject openEv = new JSONObject();
                        openEv.put("reqId", reqId);
                        openEv.put("sessionId", sessionId);
                        openEv.put("hostId", ctx.hostId);
                        openEv.put("status", "connected");
                        openEv.put("rttMs", rttMs);
                        openEv.put("serverVersion", ctx.session.getServerVersion());
                        emitToJs("ssh_connected", openEv);

                        if (!startupCmd.isEmpty()) {
                            os.write((startupCmd + "\n").getBytes(StandardCharsets.UTF_8));
                            os.flush();
                        }

                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = is.read(buf)) != -1) {
                            emitRawTerminalBytes(sessionId, buf, n);
                        }

                        int exitCode = channel.getExitStatus();
                        closeSessionInternal(sessionId);
                        JSONObject exitEv = new JSONObject();
                        exitEv.put("sessionId", sessionId);
                        exitEv.put("exitCode", exitCode);
                        exitEv.put("code", exitCode);
                        emitToJs("terminal_exit", exitEv);
                    } catch (Exception e) {
                        closeSessionInternal(sessionId);
                        try {
                            JSONObject errEv = new JSONObject();
                            errEv.put("reqId", reqId);
                            errEv.put("sessionId", sessionId);
                            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                            errEv.put("error", msg);
                            emitToJs("terminal_error", errEv);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void testSshConnection(final String reqId, final String jsonConfig) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    SshContext ctx = null;
                    try {
                        JSONObject cfg = new JSONObject(jsonConfig);
                        ctx = createConnectedSshContext(cfg);
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId);
                        res.put("ok", true);
                        res.put("sessionId", cfg.optString("sessionId", "test-" + System.currentTimeMillis()));
                        res.put("serverVersion", ctx.session.getServerVersion());
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    } finally {
                        if (ctx != null) {
                            try { if (ctx.session != null) ctx.session.disconnect(); } catch (Exception ignored) {}
                            for (Session js : ctx.jumpSessions) {
                                try { if (js != null) js.disconnect(); } catch (Exception ignored) {}
                            }
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void writeTerminalBytesB64(final String sessionId, final String dataB64) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
                        SshContext sc = sshSessions.get(sessionId);
                        if (sc != null && sc.shellOut != null) {
                            sc.shellOut.write(bytes);
                            sc.shellOut.flush();
                            return;
                        }
                        Process proc = localShells.get(sessionId);
                        if (proc != null) {
                            OutputStream os = proc.getOutputStream();
                            os.write(bytes);
                            os.flush();
                            return;
                        }
                        Socket sock = tcpSockets.get(sessionId);
                        if (sock != null && !sock.isClosed()) {
                            OutputStream os = sock.getOutputStream();
                            os.write(bytes);
                            os.flush();
                        }
                    } catch (Exception e) {
                        try {
                            JSONObject errEv = new JSONObject();
                            errEv.put("sessionId", sessionId);
                            errEv.put("error", e.getMessage());
                            emitToJs("terminal_error", errEv);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void resizeSshPty(final String sessionId, final int cols, final int rows) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        SshContext sc = sshSessions.get(sessionId);
                        if (sc != null && sc.shellChannel != null && sc.shellChannel.isConnected()) {
                            int c = Math.max(20, cols);
                            int r = Math.max(6, rows);
                            sc.shellChannel.setPtySize(c, r, c * 8, r * 16);
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        // =====================================================================
        // 2. Local Android Shell Session (/system/bin/sh -> xterm.js)
        // =====================================================================
        @JavascriptInterface
        public void startLocalShell(final String reqId, final String sessionId, final String initDir) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        closeSessionInternal(sessionId);
                        File workDir = (initDir != null && !initDir.isEmpty()) ? new File(initDir) : getFilesDir();
                        if (!workDir.exists() || !workDir.isDirectory()) {
                            workDir = getFilesDir();
                        }
                        ProcessBuilder pb = new ProcessBuilder("/system/bin/sh", "-i");
                        pb.directory(workDir);
                        pb.redirectErrorStream(true);
                        Map<String, String> env = pb.environment();
                        env.put("TERM", "xterm-256color");
                        env.put("HOME", getFilesDir().getAbsolutePath());
                        final Process proc = pb.start();
                        localShells.put(sessionId, proc);

                        JSONObject openEv = new JSONObject();
                        openEv.put("reqId", reqId);
                        openEv.put("sessionId", sessionId);
                        openEv.put("status", "connected");
                        emitToJs("ssh_connected", openEv);

                        InputStream is = proc.getInputStream();
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = is.read(buf)) != -1) {
                            emitRawTerminalBytes(sessionId, buf, n);
                        }
                        int code = proc.waitFor();
                        localShells.remove(sessionId);
                        JSONObject exitEv = new JSONObject();
                        exitEv.put("sessionId", sessionId);
                        exitEv.put("exitCode", code);
                        exitEv.put("code", code);
                        emitToJs("terminal_exit", exitEv);
                    } catch (Exception e) {
                        try {
                            JSONObject errEv = new JSONObject();
                            errEv.put("reqId", reqId);
                            errEv.put("sessionId", sessionId);
                            errEv.put("error", e.getMessage());
                            emitToJs("terminal_error", errEv);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        // =====================================================================
        // 3. Raw Telnet / TCP Socket Session (-> xterm.js)
        // =====================================================================
        @JavascriptInterface
        public void connectTcpSession(final String reqId, final String sessionId, final String host, final int port) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    long t0 = System.currentTimeMillis();
                    try {
                        closeSessionInternal(sessionId);
                        Socket sock = new Socket();
                        sock.connect(new InetSocketAddress(host, port), 8000);
                        sock.setKeepAlive(true);
                        long rtt = System.currentTimeMillis() - t0;
                        tcpSockets.put(sessionId, sock);

                        JSONObject openEv = new JSONObject();
                        openEv.put("reqId", reqId);
                        openEv.put("sessionId", sessionId);
                        openEv.put("status", "connected");
                        openEv.put("rttMs", rtt);
                        openEv.put("remoteIp", sock.getInetAddress().getHostAddress());
                        emitToJs("ssh_connected", openEv);

                        InputStream is = sock.getInputStream();
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = is.read(buf)) != -1) {
                            emitRawTerminalBytes(sessionId, buf, n);
                        }
                        tcpSockets.remove(sessionId);
                        JSONObject exitEv = new JSONObject();
                        exitEv.put("sessionId", sessionId);
                        exitEv.put("exitCode", 0);
                        exitEv.put("code", 0);
                        emitToJs("terminal_exit", exitEv);
                    } catch (Exception e) {
                        try {
                            JSONObject errEv = new JSONObject();
                            errEv.put("reqId", reqId);
                            errEv.put("sessionId", sessionId);
                            errEv.put("error", e.getMessage());
                            emitToJs("terminal_error", errEv);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void closeSession(final String sessionId) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    closeSessionInternal(sessionId);
                }
            });
        }

        // =====================================================================
        // 4. REAL Stateful SFTP Sessions over JSch (Strictly Pull-Only / Read-Only on Remote)
        // =====================================================================
        @JavascriptInterface
        public void sftpOpenSession(final String reqId, final String sftpId, final String sourceSessionId, final String sshConfigJson) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    SftpContext sfc = new SftpContext();
                    sfc.sftpId = sftpId;
                    sfc.sourceSessionId = sourceSessionId;
                    try {
                        JSONObject cfg = (sshConfigJson != null && !sshConfigJson.isEmpty())
                                ? new JSONObject(sshConfigJson)
                                : new JSONObject();
                        sfc.hostId = cfg.optString("hostId", "");
                        sfc.rawOptions = cfg;

                        Session targetSession = null;
                        if (sourceSessionId != null && !sourceSessionId.isEmpty()) {
                            SshContext existing = sshSessions.get(sourceSessionId);
                            if (existing != null && existing.session != null && existing.session.isConnected()) {
                                targetSession = existing.session;
                            }
                        }
                        if (targetSession == null && !sfc.hostId.isEmpty()) {
                            for (SshContext sc : sshSessions.values()) {
                                if (sfc.hostId.equals(sc.hostId) && sc.session != null && sc.session.isConnected()) {
                                    targetSession = sc.session;
                                    break;
                                }
                            }
                        }
                        if (targetSession == null) {
                            SshContext created = createConnectedSshContext(cfg);
                            sfc.dedicatedSession = created.session;
                            sfc.jumpSessions.addAll(created.jumpSessions);
                            targetSession = created.session;
                        }
                        sfc.activeSession = targetSession;
                        ChannelSftp channel = (ChannelSftp) targetSession.openChannel("sftp");
                        channel.connect(12000);
                        sfc.channel = channel;
                        sftpSessions.put(sftpId, sfc);

                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId);
                        res.put("ok", true);
                        res.put("sftpId", sftpId);
                        res.put("sourceSessionId", sourceSessionId);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        closeSftpInternal(sftpId);
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        private ChannelSftp ensureSftpChannel(String sftpId) throws Exception {
            SftpContext sfc = sftpSessions.get(sftpId);
            if (sfc == null) throw new IllegalStateException("SFTP session not found: " + sftpId);
            synchronized (sfc) {
                if (sfc.channel != null && sfc.channel.isConnected()) {
                    return sfc.channel;
                }
                if (sfc.activeSession == null || !sfc.activeSession.isConnected()) {
                    SshContext created = createConnectedSshContext(sfc.rawOptions);
                    sfc.dedicatedSession = created.session;
                    sfc.jumpSessions.addAll(created.jumpSessions);
                    sfc.activeSession = created.session;
                }
                ChannelSftp ch = (ChannelSftp) sfc.activeSession.openChannel("sftp");
                ch.connect(12000);
                sfc.channel = ch;
                return ch;
            }
        }

        private String modeToOctalPerm(int mode) {
            int p = mode & 0777;
            return String.format("%03o", p);
        }

        private String modeToRwxPerm(int mode) {
            StringBuilder sb = new StringBuilder(9);
            int[] shifts = {6, 3, 0};
            for (int sh : shifts) {
                int bits = (mode >> sh) & 7;
                sb.append((bits & 4) != 0 ? 'r' : '-');
                sb.append((bits & 2) != 0 ? 'w' : '-');
                sb.append((bits & 1) != 0 ? 'x' : '-');
            }
            return sb.toString();
        }

        @JavascriptInterface
        public void sftpList(final String reqId, final String sftpId, final String remotePath) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        String targetDir;
                        synchronized (sftp) {
                            targetDir = (remotePath == null || remotePath.trim().isEmpty() || ".".equals(remotePath.trim()) || "~".equals(remotePath.trim()))
                                    ? sftp.getHome()
                                    : remotePath.trim();
                            @SuppressWarnings("unchecked")
                            Vector<ChannelSftp.LsEntry> list = sftp.ls(targetDir);
                            JSONArray arr = new JSONArray();
                            if (list != null) {
                                for (ChannelSftp.LsEntry entry : list) {
                                    String name = entry.getFilename();
                                    if (".".equals(name) || "..".equals(name)) continue;
                                    SftpATTRS attrs = entry.getAttrs();
                                    String type = "file";
                                    String linkTarget = null;
                                    if (attrs.isDir()) {
                                        type = "directory";
                                    } else if (attrs.isLink()) {
                                        type = "symlink";
                                        try {
                                            String fullPath = "/".equals(targetDir) ? ("/" + name) : (targetDir.replaceAll("/+$", "") + "/" + name);
                                            SftpATTRS targetAttrs = sftp.stat(fullPath);
                                            linkTarget = targetAttrs.isDir() ? "directory" : "file";
                                        } catch (Exception ignored) {
                                            linkTarget = "file";
                                        }
                                    }
                                    JSONObject item = new JSONObject();
                                    item.put("name", name);
                                    item.put("type", type);
                                    if (linkTarget != null) item.put("linkTarget", linkTarget);
                                    item.put("size", attrs.getSize() + " bytes");
                                    long mtimeMs = ((long) attrs.getMTime()) * 1000L;
                                    item.put("lastModified", mtimeMs);
                                    item.put("permissions", modeToRwxPerm(attrs.getPermissions()));
                                    item.put("owner", String.valueOf(attrs.getUId()));
                                    arr.put(item);
                                }
                            }
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", true);
                            res.put("entries", arr);
                            emitToJs("async_response", res);
                        }
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpStat(final String reqId, final String sftpId, final String remotePath, final boolean followLinks) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                            SftpATTRS attrs = followLinks ? sftp.stat(remotePath) : sftp.lstat(remotePath);
                            JSONObject statObj = new JSONObject();
                            String name = new File(remotePath).getName();
                            statObj.put("name", name.isEmpty() ? "/" : name);
                            statObj.put("type", attrs.isDir() ? "directory" : (attrs.isLink() ? "symlink" : "file"));
                            statObj.put("size", attrs.getSize());
                            statObj.put("sizeKnown", true);
                            statObj.put("lastModified", ((long) attrs.getMTime()) * 1000L);
                            statObj.put("permissions", modeToOctalPerm(attrs.getPermissions()));

                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", true);
                            res.put("stat", statObj);
                            emitToJs("async_response", res);
                        }
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("notFound", true);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpHomeAndRealpath(final String reqId, final String sftpId, final String remotePath) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                            String resolved;
                            if (remotePath == null || remotePath.isEmpty() || ".".equals(remotePath) || "~".equals(remotePath)) {
                                resolved = sftp.getHome();
                            } else {
                                resolved = sftp.realpath(remotePath);
                            }
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", true);
                            res.put("path", resolved);
                            emitToJs("async_response", res);
                        }
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpReadFile(final String reqId, final String sftpId, final String remotePath, final boolean asBase64) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        synchronized (sftp) {
                            try (InputStream is = sftp.get(remotePath)) {
                            byte[] buf = new byte[16384];
                            int n;
                            int total = 0;
                            while ((n = is.read(buf)) != -1) {
                                if (total > 8 * 1024 * 1024 - n) throw new java.io.IOException("File exceeds 8 MiB read limit; use download instead");
                                baos.write(buf, 0, n);
                                total += n;
                            }
                            }
                        }
                        byte[] bytes = baos.toByteArray();
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId);
                        res.put("ok", true);
                        if (asBase64) {
                            res.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                        } else {
                            res.put("content", new String(bytes, StandardCharsets.UTF_8));
                        }
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpWriteFile(final String reqId, final String sftpId, final String remotePath, final String contentOrB64, final boolean isBase64) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        byte[] bytes = isBase64 ? Base64.decode(contentOrB64, Base64.DEFAULT) : contentOrB64.getBytes(StandardCharsets.UTF_8);
                        String stagingPath = remotePath + ".netcatty-write-" + java.util.UUID.randomUUID().toString();
                        try {
                            try (InputStream input = new ByteArrayInputStream(bytes)) { sftp.put(input, stagingPath, ChannelSftp.OVERWRITE); }
                            if (sftp.stat(stagingPath).getSize() != bytes.length) throw new java.io.IOException("Incomplete write");
                            sftp.rename(stagingPath, remotePath);
                        } finally {
                            try { sftp.rm(stagingPath); } catch (Exception ignored) {}
                        }
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpMkdir(final String reqId, final String sftpId, final String remotePath) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        sftp.mkdir(remotePath);
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpDelete(final String reqId, final String sftpId, final String remotePath) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        deleteSftpEntryRecursive(sftp, remotePath);
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpRename(final String reqId, final String sftpId, final String oldPath, final String newPath) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        sftp.rename(oldPath, newPath);
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpChmod(final String reqId, final String sftpId, final String remotePath, final String modeOctal) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        if (modeOctal == null || !modeOctal.matches("[0-7]{3,4}")) throw new IllegalArgumentException("Invalid octal mode");
                        sftp.chmod(Integer.parseInt(modeOctal, 8), remotePath);
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpStreamUploadFromLocal(final String reqId, final String transferId, final String sftpId, final String localPath, final String remotePath) {
            ioPool.execute(new Runnable() {
                @Override public void run() {
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        synchronized (sftp) {
                        final File source = resolveLocalFile(localPath);
                        if (!source.isFile()) throw new java.io.IOException("Upload source is not a file");
                        final long startedAt = System.currentTimeMillis();
                        final String uploadPath = remotePath + ".netcatty-upload-" + java.util.UUID.randomUUID().toString();
                        try {
                        try (InputStream input = new FileInputStream(source)) {
                            sftp.put(input, uploadPath, new SftpProgressMonitor() {
                                private long transferred;
                                @Override public void init(int op, String src, String dst, long max) {}
                                @Override public boolean count(long count) {
                                    transferred += count;
                                    try {
                                        JSONObject event = new JSONObject();
                                        event.put("type", "progress"); event.put("direction", "upload");
                                        event.put("transferId", transferId); event.put("transferred", transferred);
                                        event.put("totalBytes", source.length());
                                        emitToJs("sftp_transfer_event", event);
                                    } catch (Exception ignored) {}
                                    return !Boolean.TRUE.equals(cancelledTransfers.get(transferId));
                                }
                                @Override public void end() {}
                            }, ChannelSftp.OVERWRITE);
                        }
                        if (Boolean.TRUE.equals(cancelledTransfers.remove(transferId))) throw new java.io.IOException("Upload cancelled");
                        if (sftp.stat(uploadPath).getSize() != source.length()) throw new java.io.IOException("Incomplete upload");
                        sftp.rename(uploadPath, remotePath);
                        JSONObject event = new JSONObject();
                        event.put("type", "completed"); event.put("direction", "upload");
                        event.put("transferId", transferId); event.put("transferred", source.length());
                        event.put("totalBytes", source.length()); event.put("startedAt", startedAt);
                        emitToJs("sftp_transfer_event", event);
                        } finally {
                            cancelledTransfers.remove(transferId);
                            try { sftp.rm(uploadPath); } catch (Exception ignored) {}
                        }
                        }
                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId); res.put("ok", true); res.put("success", true);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId); res.put("ok", false); res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "SFTP operation failed");
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void sftpStreamDownloadToLocal(final String reqId, final String transferId, final String sftpId, final String remotePath, final String localPath) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    final long startedAt = System.currentTimeMillis();
                    File stagingFile = null;
                    try {
                        ChannelSftp sftp = ensureSftpChannel(sftpId);
                        final File destFile = resolveLocalFile(localPath).getAbsoluteFile();
                        if (destFile.getParentFile() != null && !destFile.getParentFile().exists()) {
                            if (!destFile.getParentFile().mkdirs() && !destFile.getParentFile().isDirectory()) throw new java.io.IOException("Cannot create download directory");
                        }
                        if (destFile.isDirectory()) throw new java.io.IOException("Download target is a directory");
                        stagingFile = File.createTempFile(".netcatty-download-", ".part", destFile.getParentFile());
                        final String fileName = destFile.getName();

                        synchronized (sftp) {
                            SftpATTRS attrs = sftp.stat(remotePath);
                            final long totalBytes = Math.max(0L, attrs.getSize());

                            JSONObject startEv = new JSONObject();
                            startEv.put("type", "started");
                            startEv.put("transferId", transferId);
                            startEv.put("direction", "download");
                            startEv.put("fileName", fileName);
                            startEv.put("sourcePath", remotePath);
                            startEv.put("targetPath", destFile.getAbsolutePath());
                            startEv.put("startedAt", startedAt);
                            startEv.put("totalBytes", totalBytes);
                            startEv.put("transferred", 0);
                            emitToJs("sftp_transfer_event", startEv);

                            try (FileOutputStream fos = new FileOutputStream(stagingFile)) {
                                sftp.get(remotePath, fos, new SftpProgressMonitor() {
                                    private long transferred = 0;
                                    private long lastEmit = 0;

                                    @Override
                                    public void init(int op, String src, String dest, long max) {}

                                    @Override
                                    public boolean count(long count) {
                                        if (Boolean.TRUE.equals(cancelledTransfers.get(transferId))) {
                                            return false;
                                        }
                                        transferred += count;
                                        long now = System.currentTimeMillis();
                                        if (now - lastEmit >= 120 || transferred >= totalBytes) {
                                            lastEmit = now;
                                            double elapsedSec = Math.max(0.05, (now - startedAt) / 1000.0);
                                            long speed = Math.round(transferred / elapsedSec);
                                            try {
                                                JSONObject progEv = new JSONObject();
                                                progEv.put("type", "progress");
                                                progEv.put("transferId", transferId);
                                                progEv.put("direction", "download");
                                                progEv.put("fileName", fileName);
                                                progEv.put("sourcePath", remotePath);
                                                progEv.put("targetPath", destFile.getAbsolutePath());
                                                progEv.put("transferred", transferred);
                                                progEv.put("totalBytes", totalBytes);
                                                progEv.put("speed", speed);
                                                emitToJs("sftp_transfer_event", progEv);
                                            } catch (Exception ignored) {}
                                        }
                                        return true;
                                    }

                                    @Override
                                    public void end() {}
                                });
                                fos.getFD().sync();
                            }

                            synchronized (cancelledTransfers) {
                            if (Boolean.TRUE.equals(cancelledTransfers.get(transferId))) {
                                JSONObject cancelEv = new JSONObject();
                                cancelEv.put("type", "cancelled");
                                cancelEv.put("transferId", transferId);
                                cancelEv.put("endedAt", System.currentTimeMillis());
                                emitToJs("sftp_transfer_event", cancelEv);

                                JSONObject res = new JSONObject();
                                res.put("reqId", reqId);
                                res.put("ok", true);
                                res.put("transferId", transferId);
                                res.put("cancelled", true);
                                emitToJs("async_response", res);
                                return;
                            }

                            if (stagingFile.length() != totalBytes) throw new java.io.IOException("Incomplete download or remote file changed");
                            // Same-directory POSIX rename atomically replaces only after a complete download.
                            android.system.Os.rename(stagingFile.getAbsolutePath(), destFile.getAbsolutePath());
                            }
                            JSONObject compEv = new JSONObject();
                            compEv.put("type", "completed");
                            compEv.put("transferId", transferId);
                            compEv.put("direction", "download");
                            compEv.put("fileName", fileName);
                            compEv.put("sourcePath", remotePath);
                            compEv.put("targetPath", destFile.getAbsolutePath());
                            compEv.put("transferred", destFile.length());
                            compEv.put("totalBytes", totalBytes);
                            compEv.put("endedAt", System.currentTimeMillis());
                            emitToJs("sftp_transfer_event", compEv);

                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", true);
                            res.put("transferId", transferId);
                            res.put("totalBytes", destFile.length());
                            res.put("localPath", destFile.getAbsolutePath());
                            emitToJs("async_response", res);
                        }
                    } catch (Exception e) {
                        try {
                            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                            JSONObject failEv = new JSONObject();
                            failEv.put("type", "failed");
                            failEv.put("transferId", transferId);
                            failEv.put("error", msg);
                            failEv.put("endedAt", System.currentTimeMillis());
                            emitToJs("sftp_transfer_event", failEv);

                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("transferId", transferId);
                            res.put("error", msg);
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    } finally {
                        if (stagingFile != null && stagingFile.exists()) stagingFile.delete();
                        cancelledTransfers.remove(transferId);
                    }
                }
            });
        }

        @JavascriptInterface
        public void cancelSftpTransfer(final String transferId) {
            if (transferId != null) {
                synchronized (cancelledTransfers) {
                    cancelledTransfers.put(transferId, true);
                }
            }
        }

        @JavascriptInterface
        public void sftpCloseSession(final String sftpId) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    closeSftpInternal(sftpId);
                }
            });
        }

        // =====================================================================
        // 5. REAL SSH Exec Channel, Server Stats & System Manager Probes
        // =====================================================================
        @JavascriptInterface
        public void sshExecOnSession(final String reqId, final String sessionId, final String sshConfigJson, final String command, final int timeoutMs, final String stdinData) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    SshContext tempCtx = null;
                    try {
                        Session targetSession = null;
                        if (sessionId != null && !sessionId.isEmpty()) {
                            SshContext sc = sshSessions.get(sessionId);
                            if (sc != null && sc.session != null && sc.session.isConnected()) {
                                targetSession = sc.session;
                            }
                        }
                        if (targetSession == null && sshConfigJson != null && !sshConfigJson.isEmpty()) {
                            JSONObject cfg = new JSONObject(sshConfigJson);
                            String hostId = cfg.optString("hostId", "");
                            if (!hostId.isEmpty()) {
                                for (SshContext sc : sshSessions.values()) {
                                    if (hostId.equals(sc.hostId) && sc.session != null && sc.session.isConnected()) {
                                        targetSession = sc.session;
                                        break;
                                    }
                                }
                            }
                            if (targetSession == null) {
                                tempCtx = createConnectedSshContext(cfg);
                                targetSession = tempCtx.session;
                            }
                        }
                        if (targetSession == null) {
                            throw new IllegalStateException("Session not found or not connected");
                        }
                        JSONObject execRes = execFullOnJschSession(targetSession, command, Math.max(3000, timeoutMs), stdinData);
                        execRes.put("reqId", reqId);
                        execRes.put("ok", true);
                        emitToJs("async_response", execRes);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("success", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    } finally {
                        if (tempCtx != null) {
                            try { if (tempCtx.session != null) tempCtx.session.disconnect(); } catch (Exception ignored) {}
                            for (Session js : tempCtx.jumpSessions) {
                                try { if (js != null) js.disconnect(); } catch (Exception ignored) {}
                            }
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void sshGetServerStats(final String reqId, final String sessionId) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        SshContext sc = sshSessions.get(sessionId);
                        if (sc == null || sc.session == null || !sc.session.isConnected()) {
                            JSONObject err = new JSONObject();
                            err.put("reqId", reqId);
                            err.put("ok", true);
                            err.put("success", false);
                            err.put("error", "Session not found or not connected");
                            emitToJs("async_response", err);
                            return;
                        }
                        JSONObject statsRes = collectLinuxServerStats(sc);
                        statsRes.put("reqId", reqId);
                        statsRes.put("ok", true);
                        emitToJs("async_response", statsRes);
                    } catch (Exception e) {
                        try {
                            JSONObject err = new JSONObject();
                            err.put("reqId", reqId);
                            err.put("ok", true);
                            err.put("success", false);
                            err.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", err);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public String getSessionRemoteInfoSync(String sessionId) {
            try {
                SshContext sc = sshSessions.get(sessionId);
                JSONObject res = new JSONObject();
                if (sc != null && sc.session != null && sc.session.isConnected()) {
                    res.put("success", true);
                    res.put("remoteSshVersion", sc.session.getServerVersion());
                    res.put("singleChannelSsh", false);
                } else {
                    res.put("success", false);
                    res.put("error", "Session not found");
                }
                return res.toString();
            } catch (Exception e) {
                return "{\"success\":false}";
            }
        }

        // =====================================================================
        // 6. REAL SSH Port Forwarding (-L Local / -R Remote via JSch)
        // =====================================================================
        @JavascriptInterface
        public void startSshPortForward(final String reqId, final String optionsJson) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    String tunnelId = "tunnel-" + System.currentTimeMillis();
                    String ruleId = tunnelId;
                    try {
                        JSONObject cfg = new JSONObject(optionsJson);
                        tunnelId = cfg.optString("tunnelId", tunnelId);
                        ruleId = cfg.optString("ruleId", tunnelId);

                        stopPortForwardInternal(tunnelId);

                        JSONObject connectingEv = new JSONObject();
                        connectingEv.put("tunnelId", tunnelId);
                        connectingEv.put("ruleId", ruleId);
                        connectingEv.put("status", "connecting");
                        emitToJs("port_forward_status", connectingEv);

                        SshContext sc = createConnectedSshContext(cfg);
                        String type = cfg.optString("type", "local");
                        String bindAddr = cfg.optString("bindAddress", cfg.optString("localHost", "127.0.0.1"));
                        int localPort = cfg.optInt("localPort", 8080);
                        String remoteHost = cfg.optString("remoteHost", "127.0.0.1");
                        int remotePort = cfg.optInt("remotePort", 80);

                        PortForwardContext pfc = new PortForwardContext();
                        pfc.tunnelId = tunnelId;
                        pfc.ruleId = ruleId;
                        pfc.session = sc.session;
                        pfc.jumpSessions.addAll(sc.jumpSessions);
                        pfc.type = type;
                        pfc.bindAddress = bindAddr;
                        pfc.localPort = localPort;
                        pfc.remoteHost = remoteHost;
                        pfc.remotePort = remotePort;
                        pfc.status = "active";

                        if ("remote".equalsIgnoreCase(type)) {
                            sc.session.setPortForwardingR(bindAddr, remotePort, remoteHost, localPort);
                        } else if ("dynamic".equalsIgnoreCase(type)) {
                            startDynamicSocks5Server(pfc);
                        } else {
                            int assigned = sc.session.setPortForwardingL(bindAddr, localPort, remoteHost, remotePort);
                            if (assigned > 0) pfc.localPort = assigned;
                        }

                        activeForwards.put(tunnelId, pfc);

                        JSONObject statusEv = new JSONObject();
                        statusEv.put("tunnelId", tunnelId);
                        statusEv.put("ruleId", ruleId);
                        statusEv.put("status", "active");
                        statusEv.put("localPort", pfc.localPort);
                        emitToJs("port_forward_status", statusEv);
                        emitPortForwardRuntimeSnapshot();

                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId);
                        res.put("ok", true);
                        res.put("success", true);
                        res.put("tunnelId", tunnelId);
                        res.put("localPort", pfc.localPort);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                            JSONObject errEv = new JSONObject();
                            errEv.put("tunnelId", tunnelId);
                            errEv.put("ruleId", ruleId);
                            errEv.put("status", "error");
                            errEv.put("error", msg);
                            emitToJs("port_forward_status", errEv);
                            emitPortForwardRuntimeSnapshot();

                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", true);
                            res.put("success", false);
                            res.put("error", msg);
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopSshPortForward(final String tunnelId) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    PortForwardContext existing = activeForwards.get(tunnelId);
                    String ruleId = existing != null ? existing.ruleId : tunnelId;
                    stopPortForwardInternal(tunnelId);
                    try {
                        JSONObject statusEv = new JSONObject();
                        statusEv.put("tunnelId", tunnelId);
                        statusEv.put("ruleId", ruleId);
                        statusEv.put("status", "inactive");
                        emitToJs("port_forward_status", statusEv);
                        emitPortForwardRuntimeSnapshot();
                    } catch (Exception ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void stopAllSshPortForwards() {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    for (String tid : new ArrayList<>(activeForwards.keySet())) {
                        stopPortForwardInternal(tid);
                    }
                    emitPortForwardRuntimeSnapshot();
                }
            });
        }

        @JavascriptInterface
        public String listPortForwardsSync() {
            try {
                JSONArray arr = new JSONArray();
                for (PortForwardContext pfc : activeForwards.values()) {
                    JSONObject item = new JSONObject();
                    item.put("tunnelId", pfc.tunnelId);
                    item.put("ruleId", pfc.ruleId);
                    item.put("type", pfc.type);
                    item.put("localPort", pfc.localPort);
                    item.put("bindAddress", pfc.bindAddress);
                    item.put("remoteHost", pfc.remoteHost);
                    item.put("remotePort", pfc.remotePort);
                    item.put("status", pfc.status);
                    arr.put(item);
                }
                return arr.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        // =====================================================================
        // 7. REAL OpenSSH KeyPair Generator (Ed25519 / ECDSA / RSA via JSch)
        // =====================================================================
        @JavascriptInterface
        public String generateRealSshKey(String keyType, int bits, String comment) {
            try {
                JSch jsch = new JSch();
                int type = KeyPair.ED25519;
                int size = 256;
                String kt = (keyType != null ? keyType.toLowerCase() : "ed25519");
                if (kt.contains("rsa")) {
                    type = KeyPair.RSA;
                    size = bits >= 2048 ? bits : 4096;
                } else if (kt.contains("ecdsa")) {
                    type = KeyPair.ECDSA;
                    size = (bits == 256 || bits == 384 || bits == 521) ? bits : 256;
                }
                KeyPair kpair = KeyPair.genKeyPair(jsch, type, size);
                ByteArrayOutputStream prvOut = new ByteArrayOutputStream();
                ByteArrayOutputStream pubOut = new ByteArrayOutputStream();
                kpair.writePrivateKey(prvOut);
                kpair.writePublicKey(pubOut, comment != null && !comment.isEmpty() ? comment : "netcatty@android");
                String fingerprint = kpair.getFingerPrint();
                kpair.dispose();

                JSONObject res = new JSONObject();
                res.put("success", true);
                res.put("ok", true);
                res.put("privateKey", new String(prvOut.toByteArray(), StandardCharsets.UTF_8));
                res.put("publicKey", new String(pubOut.toByteArray(), StandardCharsets.UTF_8).trim());
                res.put("fingerprint", fingerprint);
                return res.toString();
            } catch (Exception e) {
                try {
                    JSONObject err = new JSONObject();
                    err.put("success", false);
                    err.put("ok", false);
                    err.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                    return err.toString();
                } catch (Exception ignored) {
                    return "{\"success\":false,\"ok\":false}";
                }
            }
        }

        // =====================================================================
        // 8. Local File System API (Android Sandbox Storage)
        // =====================================================================
        @JavascriptInterface
        public String getHomeDirSync() {
            return getFilesDir().getAbsolutePath();
        }

        @JavascriptInterface
        public String listLocalFiles(String dirPath) {
            try {
                File dir = resolveLocalFile(dirPath);
                if (!dir.exists() || !dir.isDirectory()) {
                    dir = getFilesDir();
                }
                File[] children = dir.listFiles();
                JSONArray arr = new JSONArray();
                SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                if (children != null) {
                    for (File f : children) {
                        JSONObject item = new JSONObject();
                        long bytes = f.isDirectory() ? 0L : f.length();
                        long mtime = f.lastModified();
                        item.put("name", f.getName());
                        item.put("path", f.getAbsolutePath());
                        item.put("type", f.isDirectory() ? "directory" : "file");
                        item.put("size", bytes + " bytes");
                        item.put("sizeBytes", bytes);
                        item.put("lastModified", isoFmt.format(new Date(mtime)));
                        item.put("lastModifiedMs", mtime);
                        String perms = (f.canRead() ? "r" : "-")
                                + (f.canWrite() ? "w" : "-")
                                + (f.canExecute() ? "x" : "-")
                                + "r-xr-x";
                        item.put("permissions", perms);
                        arr.put(item);
                    }
                }
                return arr.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String statLocalFileSync(String filePath) {
            try {
                File f = resolveLocalFile(filePath);
                if (!f.exists()) return "";
                SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                JSONObject obj = new JSONObject();
                obj.put("name", f.getName().isEmpty() ? "/" : f.getName());
                obj.put("type", f.isDirectory() ? "directory" : "file");
                obj.put("size", f.isDirectory() ? 0 : f.length());
                obj.put("lastModified", isoFmt.format(new Date(f.lastModified())));
                obj.put("lastModifiedMs", f.lastModified());
                String perms = (f.canRead() ? "r" : "-")
                        + (f.canWrite() ? "w" : "-")
                        + (f.canExecute() ? "x" : "-")
                        + "r-xr-x";
                obj.put("permissions", perms);
                return obj.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String readLocalFileB64(String filePath, int maxBytes) {
            try {
                File f = resolveLocalFile(filePath);
                if (!f.exists() || !f.isFile()) return "";
                long len = f.length();
                int limit = maxBytes > 0 ? Math.min((int) len, maxBytes) : (int) Math.min(len, 10 * 1024 * 1024);
                byte[] data = new byte[limit];
                try (FileInputStream fis = new FileInputStream(f)) {
                    if (maxBytes > 0 && len > maxBytes) {
                        fis.skip(len - maxBytes);
                    }
                    int read = fis.read(data);
                    if (read <= 0) return "";
                    return Base64.encodeToString(data, 0, read, Base64.NO_WRAP);
                }
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean writeLocalFileB64(String filePath, String contentB64) {
            try {
                File f = resolveLocalFile(filePath);
                if (f.getParentFile() != null && !f.getParentFile().exists()) {
                    f.getParentFile().mkdirs();
                }
                byte[] bytes = Base64.decode(contentB64, Base64.DEFAULT);
                try (FileOutputStream fos = new FileOutputStream(f, false)) {
                    fos.write(bytes);
                    fos.flush();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean writeLocalFileText(String filePath, String content) {
            try {
                File f = resolveLocalFile(filePath);
                if (f.getParentFile() != null && !f.getParentFile().exists()) {
                    f.getParentFile().mkdirs();
                }
                try (FileOutputStream fos = new FileOutputStream(f, false)) {
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                    fos.flush();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean deleteLocalFile(String filePath) {
            try {
                File f = resolveLocalFile(filePath);
                return deleteRecursively(f);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean renameLocalFile(String oldPath, String newPath) {
            try {
                File src = resolveLocalFile(oldPath);
                File dst = resolveLocalFile(newPath);
                return src.renameTo(dst);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean mkdirLocal(String dirPath) {
            try {
                File f = resolveLocalFile(dirPath);
                return f.exists() ? f.isDirectory() : f.mkdirs();
            } catch (Exception e) {
                return false;
            }
        }

        // =====================================================================
        // 9. Strictly Pull-Only Cloud Sync HTTP Bridge & AI Stream Bridge
        // =====================================================================
        @JavascriptInterface
        public void httpFetchAsync(final String reqId, final String urlStr, final String method, final String headersJson, final String bodyStr, final boolean skipTlsVerify) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        String upperMethod = (method != null && !method.trim().isEmpty())
                                ? method.trim().toUpperCase(Locale.US) : "GET";
                        JSONObject hdrs = (headersJson != null && !headersJson.isEmpty())
                                ? new JSONObject(headersJson) : new JSONObject();

                        boolean isStandardMethod = "GET".equals(upperMethod) || "POST".equals(upperMethod)
                                || "HEAD".equals(upperMethod) || "OPTIONS".equals(upperMethod)
                                || "PUT".equals(upperMethod) || "DELETE".equals(upperMethod);

                        if (!isStandardMethod) {
                            JSONObject rawRes = executeRawHttpSocketRequest(urlStr, upperMethod, hdrs, bodyStr, skipTlsVerify, 5);
                            rawRes.put("reqId", reqId);
                            emitToJs("async_response", rawRes);
                            return;
                        }

                        conn = openHttpConnection(urlStr, upperMethod, skipTlsVerify);
                        conn.setInstanceFollowRedirects(false);
                        JSONArray names = hdrs.names();
                        if (names != null) {
                            for (int i = 0; i < names.length(); i++) {
                                String k = names.getString(i);
                                String v = hdrs.optString(k, "");
                                if (!v.isEmpty()) conn.setRequestProperty(k, v);
                            }
                        }
                        if (bodyStr != null && !bodyStr.isEmpty() && !"GET".equalsIgnoreCase(upperMethod) && !"HEAD".equalsIgnoreCase(upperMethod)) {
                            conn.setDoOutput(true);
                            byte[] bytes = bodyStr.getBytes(StandardCharsets.UTF_8);
                            OutputStream os = conn.getOutputStream();
                            os.write(bytes);
                            os.flush();
                            os.close();
                        }

                        int status = conn.getResponseCode();
                        JSONObject respHeaders = new JSONObject();
                        Map<String, List<String>> hMap = conn.getHeaderFields();
                        if (hMap != null) {
                            for (Map.Entry<String, List<String>> entry : hMap.entrySet()) {
                                if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                                    respHeaders.put(entry.getKey().toLowerCase(Locale.US), entry.getValue().get(0));
                                }
                            }
                        }
                        InputStream is = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
                        String respData = "";
                        if (is != null) {
                            ByteArrayOutputStream baos = new ByteArrayOutputStream();
                            byte[] buf = new byte[8192];
                            int n;
                            while ((n = is.read(buf)) != -1) {
                                baos.write(buf, 0, n);
                            }
                            is.close();
                            respData = new String(baos.toByteArray(), StandardCharsets.UTF_8);
                        }

                        JSONObject res = new JSONObject();
                        res.put("reqId", reqId);
                        res.put("ok", status >= 200 && status < 300);
                        res.put("status", status);
                        res.put("headers", respHeaders);
                        res.put("data", respData);
                        emitToJs("async_response", res);
                    } catch (Exception e) {
                        try {
                            JSONObject res = new JSONObject();
                            res.put("reqId", reqId);
                            res.put("ok", false);
                            res.put("status", 0);
                            res.put("data", "");
                            res.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("async_response", res);
                        } catch (Exception ignored) {}
                    } finally {
                        if (conn != null) conn.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void startAiChatStream(final String reqId, final String streamRequestId, final String urlStr, final String headersJson, final String bodyStr, final boolean skipTlsVerify) {
            ioPool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection conn = null;
                    try {
                        conn = openHttpConnection(urlStr, "POST", skipTlsVerify);
                        conn.setReadTimeout(180000);
                        activeAiStreams.put(streamRequestId, conn);

                        if (headersJson != null && !headersJson.isEmpty()) {
                            JSONObject hdrs = new JSONObject(headersJson);
                            JSONArray names = hdrs.names();
                            if (names != null) {
                                for (int i = 0; i < names.length(); i++) {
                                    String k = names.getString(i);
                                    String v = hdrs.optString(k, "");
                                    if (!v.isEmpty()) conn.setRequestProperty(k, v);
                                }
                            }
                        }
                        if (bodyStr != null && !bodyStr.isEmpty()) {
                            conn.setDoOutput(true);
                            byte[] bytes = bodyStr.getBytes(StandardCharsets.UTF_8);
                            OutputStream os = conn.getOutputStream();
                            os.write(bytes);
                            os.flush();
                            os.close();
                        }

                        int statusCode = conn.getResponseCode();
                        String statusText = conn.getResponseMessage() != null ? conn.getResponseMessage() : "";

                        JSONObject initRes = new JSONObject();
                        initRes.put("reqId", reqId);
                        initRes.put("ok", true);
                        initRes.put("statusCode", statusCode);
                        initRes.put("statusText", statusText);
                        emitToJs("async_response", initRes);

                        InputStream is = (statusCode >= 200 && statusCode < 300) ? conn.getInputStream() : conn.getErrorStream();
                        if (statusCode < 200 || statusCode >= 300) {
                            String errBody = "";
                            if (is != null) {
                                BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                                StringBuilder sb = new StringBuilder();
                                String line;
                                while ((line = br.readLine()) != null) sb.append(line).append("\n");
                                br.close();
                                errBody = sb.toString();
                            }
                            JSONObject errEv = new JSONObject();
                            errEv.put("requestId", streamRequestId);
                            errEv.put("error", "HTTP " + statusCode + ": " + errBody);
                            emitToJs("ai_stream_error", errEv);
                            return;
                        }

                        if (is != null) {
                            BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                            String line;
                            while ((line = br.readLine()) != null) {
                                String trimmed = line.trim();
                                if (trimmed.startsWith("data:")) {
                                    String payload = trimmed.substring(5).trim();
                                    if (!payload.isEmpty() && !"[DONE]".equals(payload)) {
                                        JSONObject dataEv = new JSONObject();
                                        dataEv.put("requestId", streamRequestId);
                                        dataEv.put("data", payload);
                                        emitToJs("ai_stream_data", dataEv);
                                    }
                                }
                            }
                            br.close();
                        }
                        JSONObject endEv = new JSONObject();
                        endEv.put("requestId", streamRequestId);
                        emitToJs("ai_stream_end", endEv);
                    } catch (Exception e) {
                        try {
                            JSONObject errEv = new JSONObject();
                            errEv.put("requestId", streamRequestId);
                            errEv.put("error", e.getMessage() != null ? e.getMessage() : e.toString());
                            emitToJs("ai_stream_error", errEv);
                        } catch (Exception ignored) {}
                    } finally {
                        activeAiStreams.remove(streamRequestId);
                        if (conn != null) conn.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public boolean cancelAiChatStream(String streamRequestId) {
            HttpURLConnection conn = activeAiStreams.remove(streamRequestId);
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored) {}
                return true;
            }
            return false;
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null) {
            onBackPressed();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        for (String sid : new ArrayList<>(sshSessions.keySet())) {
            closeSessionInternal(sid);
        }
        for (String sfid : new ArrayList<>(sftpSessions.keySet())) {
            closeSftpInternal(sfid);
        }
        for (String tid : new ArrayList<>(activeForwards.keySet())) {
            stopPortForwardInternal(tid);
        }
        ioPool.shutdownNow();
        super.onDestroy();
    }
}
