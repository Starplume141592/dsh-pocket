// Command tsnet-sidecar 把 Tailscale 节点和 Funnel 直接嵌进 dsh-mobile 插件。
//
// 它由插件拉起，做两件事：
//  1. 在 127.0.0.1:8479 暴露只读状态接口，插件轮询拿登录链接和 Funnel 地址；
//  2. 把 https://<hostname>.<tailnet>.ts.net 反代到本机网关 http://127.0.0.1:8470。
//
// 不需要管理员权限，不安装系统服务，不创建虚拟网卡，也不改路由和 DNS。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

// tsnet 在交互登录时会把 https://login.tailscale.com/a/xxxx 打到 UserLogf 里。
var authURLPattern = regexp.MustCompile(`https://login\.tailscale\.com/[a-z]/[A-Za-z0-9_-]+`)

type status struct {
	mu         sync.Mutex
	phase      string
	hostname   string
	authURL    string
	funnelURL  string
	tailnetURL string
	errText    string
	started    time.Time
}

func newStatus(hostname string) *status {
	return &status{phase: "starting", hostname: hostname, started: time.Now()}
}

func (s *status) update(fn func(*status)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s)
}

func (s *status) snapshot() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return map[string]any{
		"ok":         s.errText == "",
		"phase":      s.phase,
		"hostname":   s.hostname,
		"authURL":    s.authURL,
		"funnelURL":  s.funnelURL,
		"tailnetURL": s.tailnetURL,
		"error":      s.errText,
		"startedAt":  s.started.UTC().Format(time.RFC3339),
		"pid":        os.Getpid(),
	}
}

func main() {
	var (
		listenAddr  = flag.String("listen", "127.0.0.1:8479", "控制接口监听地址")
		target      = flag.String("target", "http://127.0.0.1:8470", "本机网关地址")
		hostname    = flag.String("hostname", "pocket", "在 tailnet 里的主机名")
		stateDir    = flag.String("dir", "", "tsnet 状态目录（默认用户配置目录下 dsh-mobile/tsnet）")
		authKey     = flag.String("authkey", "", "Tailscale auth key（可选，不填走交互登录）")
		funnelAddr  = flag.String("funnel", "", "Funnel 监听地址（留空表示不公开到公网）")
		tailnetAddr = flag.String("tailnet", ":8443", "仅 tailnet 内可达的 HTTPS 监听地址")
		logPath     = flag.String("log", "", "日志文件（可选）")
	)
	flag.Parse()

	if *stateDir == "" {
		*stateDir = defaultStateDir()
	}
	if err := os.MkdirAll(*stateDir, 0o700); err != nil {
		log.Fatalf("创建状态目录失败: %v", err)
	}
	if *logPath != "" {
		f, err := os.OpenFile(*logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			log.Printf("打开日志文件失败: %v", err)
		} else {
			log.SetOutput(io.MultiWriter(os.Stderr, f))
		}
	}
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("tsnet-sidecar 启动 hostname=%s target=%s", *hostname, *target)

	st := newStatus(*hostname)
	serveControl(*listenAddr, st)

	srv := &tsnet.Server{
		Hostname: *hostname,
		Dir:      *stateDir,
		AuthKey:  *authKey,
	}
	defer srv.Close()

	srv.UserLogf = func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		log.Printf("[tsnet] %s", msg)
		if m := authURLPattern.FindString(msg); m != "" {
			st.update(func(s *status) {
				s.authURL = m
				s.phase = "need-login"
			})
			log.Printf("需要登录 Tailscale: %s", m)
		}
	}
	srv.Logf = func(format string, args ...any) {
		log.Printf("[tsnet:debug] "+format, args...)
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()

		st.update(func(s *status) { s.phase = "connecting" })
		if _, err := srv.Up(ctx); err != nil {
			fail(st, "连接 Tailscale 失败: "+err.Error())
			return
		}

		// 证书域名偶尔要等一两秒才就绪。
		var domain string
		for i := 0; i < 20; i++ {
			if domains := srv.CertDomains(); len(domains) > 0 {
				domain = strings.TrimSuffix(domains[0], ".")
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
		if domain == "" {
			fail(st, "没有拿到 Tailscale 域名（确认 tailnet 已开启 HTTPS 证书）")
			return
		}

		served := false
		if *tailnetAddr != "" {
			ln, err := srv.ListenTLS("tcp", *tailnetAddr)
			if err != nil {
				fail(st, "开启 tailnet 监听失败: "+err.Error())
				return
			}
			link := "https://" + domain + portSuffix(*tailnetAddr)
			st.update(func(s *status) {
				s.phase = "serving"
				s.tailnetURL = link
				s.errText = ""
			})
			log.Printf("tailnet 已就绪: %s -> %s", link, *target)
			served = true
			go func() {
				if err := http.Serve(ln, newProxy(*target, true)); err != nil {
					fail(st, "tailnet 服务退出: "+err.Error())
				}
			}()
		}

		if *funnelAddr != "" {
			ln, err := srv.ListenFunnel("tcp", *funnelAddr)
			if err != nil {
				msg := "开启 Funnel 失败: " + err.Error()
				if strings.Contains(strings.ToLower(err.Error()), "funnel") {
					msg += "（到 https://login.tailscale.com/f/funnel 开启 HTTPS 和 Funnel）"
				}
				fail(st, msg)
				return
			}
			link := "https://" + domain
			st.update(func(s *status) {
				s.phase = "serving"
				s.funnelURL = link
				s.errText = ""
			})
			log.Printf("Funnel 已就绪: %s -> %s", link, *target)
			served = true
			go func() {
				if err := http.Serve(ln, newProxy(*target, false)); err != nil {
					fail(st, "Funnel 服务退出: "+err.Error())
				}
			}()
		}

		if !served {
			fail(st, "没有启用任何监听（tailnet/funnel 都为空）")
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt)
	<-ch
	log.Printf("收到退出信号，正在关闭")
}

func defaultStateDir() string {
	if dir := os.Getenv("DSH_TSNET_DIR"); dir != "" {
		return dir
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	return filepath.Join(base, "dsh-mobile", "tsnet")
}

func fail(st *status, msg string) {
	log.Print(msg)
	st.update(func(s *status) {
		s.phase = "error"
		s.errText = msg
	})
}

func serveControl(addr string, st *status) {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		_ = json.NewEncoder(w).Encode(st.snapshot())
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "text/plain; charset=utf-8")
		_, _ = io.WriteString(w, "ok")
	})

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("控制接口监听失败: %v", err)
	}
	go func() {
		if err := http.Serve(ln, mux); err != nil {
			log.Printf("控制接口退出: %v", err)
		}
	}()
}

func portSuffix(addr string) string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" || port == "443" {
		return ""
	}
	return ":" + port
}

// newProxy 反代到本机网关。网关靠 X-Forwarded-Proto 给设备 cookie 加 Secure，
// 靠 X-Forwarded-For 记录真实设备地址；这两个头必须由 sidecar 覆盖，不能让客户端伪造。
// tailnet 入口额外带 X-Pocket-Tailnet，网关据此免配对；公网入口必须剥掉这个头。
func newProxy(raw string, tailnet bool) http.Handler {
	u, err := url.Parse(raw)
	if err != nil {
		log.Fatalf("网关地址不合法 %q: %v", raw, err)
	}
	rp := httputil.NewSingleHostReverseProxy(u)
	rp.ErrorLog = log.Default()
	director := rp.Director
	rp.Director = func(req *http.Request) {
		director(req)
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", req.Host)
		if tailnet {
			req.Header.Set("X-Pocket-Tailnet", "1")
		} else {
			req.Header.Del("X-Pocket-Tailnet")
		}
		if host, _, err := net.SplitHostPort(req.RemoteAddr); err == nil {
			req.Header.Set("X-Forwarded-For", host)
		}
	}
	return rp
}
