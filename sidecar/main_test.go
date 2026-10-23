package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPortSuffix(t *testing.T) {
	cases := map[string]string{
		":443":           "",
		":8443":          ":8443",
		"127.0.0.1:8443": ":8443",
		"":               "",
	}
	for addr, want := range cases {
		if got := portSuffix(addr); got != want {
			t.Fatalf("portSuffix(%q) = %q, want %q", addr, got, want)
		}
	}
}

func TestTailnetProxyHeader(t *testing.T) {
	seen := make(chan string, 2)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Header.Get("X-Pocket-Tailnet")
		_, _ = io.WriteString(w, "ok")
	}))
	defer target.Close()

	proxy := httptest.NewServer(newProxy(target.URL, true))
	defer proxy.Close()
	res, err := http.Get(proxy.URL)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := <-seen; got != "1" {
		t.Fatalf("tailnet request header = %q, want 1", got)
	}

	public := httptest.NewServer(newProxy(target.URL, false))
	defer public.Close()
	req, _ := http.NewRequest(http.MethodGet, public.URL, nil)
	req.Header.Set("X-Pocket-Tailnet", "1") // a client must not be able to spoof it
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if got := <-seen; got != "" {
		t.Fatalf("public request leaked tailnet header %q", got)
	}
}
