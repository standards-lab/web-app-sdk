// Command server is the browser tier's upload server. On the one loopback address -addr names, it
// serves the repository's files under -root as they are on disk, an .html, .js, or .css file with
// its content type and Cache-Control: no-store and any other path a 404; mounts go-web-sdk's
// upload.Handler over a MemoryStore at /uploads, its max-append-size -limit bytes unless a control
// sets another; and answers the tests' controls. It keeps no connection alive: every request
// arrives on a connection of its own.
//
//   - GET /control/ready answers 204 once the server listens.
//   - PUT /control takes a JSON {"fault", "count", "token", "limit"}, replacing all four. A fault
//     fires on the first count upload requests it applies to, once when count is 0: "unavailable"
//     answers any request 503; "throttled" answers any request 429; "stall" holds any request
//     until its client goes away, or answers it 503 after 5 seconds; "lose-created" closes a
//     creation's connection in place of its 201; "drop-append" closes the connection of the first
//     append at each offset of an upload once half its content has arrived, before the handler
//     commits any of it; "garble-offset" answers a HEAD with Upload-Offset 1.5;
//     "reject-complete" answers the completing request a 422 problem, with Upload-Complete: ?1, in
//     place of its 200. A token makes every upload request without Authorization: Bearer <token>
//     a 401 problem. A positive limit is the handler's max-append-size from then on, and 0
//     restores -limit's.
//   - GET /control/requests answers every upload request since the last read, in order, as JSON
//     {"method", "path", "headers", "at"}, each header's lines joined with ", " under its
//     lowercase name, and at the milliseconds since the Unix epoch when the request arrived.
//   - GET /control/uploads/{id} answers the upload's state as JSON {"offset", "length",
//     "complete", "mediaType", "name", "digest", "size", "sha256"}: the digest the creation's
//     Repr-Digest carried and the SHA-256 of the bytes stored, each in hex, and size their count;
//     a completed upload's is what its completion kept. An unknown id is a 404.
//
// A completing request's response is a 200 JSON {"id", "mediaType", "digest", "name", "length"}.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/standards-lab/go-web-sdk"
	"github.com/standards-lab/go-web-sdk/upload"
)

var types = map[string]string{
	".html": "text/html",
	".js":   "text/javascript",
	".css":  "text/css",
}

type settings struct {
	Fault string `json:"fault"`
	Count int    `json:"count"`
	Token string `json:"token"`
	Limit int64  `json:"limit"`
}

type request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	At      float64           `json:"at"`
}

type state struct {
	Offset    int64  `json:"offset"`
	Length    int64  `json:"length"`
	Complete  bool   `json:"complete"`
	MediaType string `json:"mediaType"`
	Name      string `json:"name"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
}

type server struct {
	root  string
	store *upload.MemoryStore
	limit int64

	mu       sync.Mutex
	settings settings
	uploads  http.Handler
	requests []request
	done     map[string]state
	dropped  map[string]bool
}

func main() {
	root := flag.String("root", ".", "the directory whose files the server serves")
	addr := flag.String("addr", "127.0.0.1:0", "the address the server listens on")
	limit := flag.Int64("limit", 1<<20, "the upload handler's max-append-size, in bytes")
	flag.Parse()
	s := &server{
		root: *root, store: upload.NewMemoryStore(), limit: *limit,
		done: map[string]state{}, dropped: map[string]bool{},
	}
	srv := &http.Server{Addr: *addr, Handler: s.routes()}
	srv.SetKeepAlivesEnabled(false)
	log.Fatal(srv.ListenAndServe())
}

func (s *server) routes() http.Handler {
	s.uploads = s.handler(s.limit)
	uploads := s.faulted(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		h := s.uploads
		s.mu.Unlock()
		h.ServeHTTP(w, r)
	}))
	mux := http.NewServeMux()
	mux.Handle("/uploads", uploads)
	mux.Handle("/uploads/", uploads)
	mux.HandleFunc("GET /control/ready", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("PUT /control", s.configure)
	mux.HandleFunc("GET /control/requests", s.log)
	mux.HandleFunc("GET /control/uploads/{id}", s.state)
	mux.HandleFunc("/", s.file)
	return mux
}

func (s *server) handler(limit int64) http.Handler {
	h := upload.Handler{
		Store:    s.store,
		Transfer: web.NewTransfer(limit, 1<<20, 5*time.Second),
		Lifetime: time.Hour,
		Complete: s.complete,
		Logger:   slog.New(slog.NewTextHandler(os.Stderr, nil)),
	}
	return web.NewModule(h.Routes("/uploads"))
}

func (s *server) file(w http.ResponseWriter, r *http.Request) {
	name := path.Clean("/" + r.URL.Path)
	kind, ok := types[path.Ext(name)]
	body, err := os.ReadFile(filepath.Join(s.root, filepath.FromSlash(name)))
	if !ok || err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(body)
}

func (s *server) configure(w http.ResponseWriter, r *http.Request) {
	var next settings
	if err := json.NewDecoder(r.Body).Decode(&next); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if next.Limit < 0 || next.Count < 0 {
		http.Error(w, "the limit or the count is negative", http.StatusBadRequest)
		return
	}
	next.Count = max(next.Count, 1)
	limit := next.Limit
	if limit == 0 {
		limit = s.limit
	}
	uploads := s.handler(limit)
	s.mu.Lock()
	s.settings = next
	s.uploads = uploads
	s.dropped = map[string]bool{}
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) log(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	requests := s.requests
	s.requests = nil
	s.mu.Unlock()
	if requests == nil {
		requests = []request{}
	}
	writeJSON(w, http.StatusOK, requests)
}

func (s *server) state(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	done, ok := s.done[id]
	s.mu.Unlock()
	if ok {
		writeJSON(w, http.StatusOK, done)
		return
	}
	offset, length, _, _, err := s.store.Progress(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	mediaType, digest, name, err := s.store.Meta(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	content, err := s.store.Open(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = content.Close() }()
	size, sum, err := hash(content)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, state{
		Offset: offset, Length: length, MediaType: mediaType, Name: name,
		Digest: digest, Size: size, SHA256: sum,
	})
}

func (s *server) complete(w http.ResponseWriter, _ *http.Request, f upload.File, content io.Reader) error {
	s.mu.Lock()
	reject := s.fire("reject-complete")
	s.mu.Unlock()
	if reject {
		return web.Problem{Status: http.StatusUnprocessableEntity, Detail: "the test server rejects the file"}
	}
	size, sum, err := hash(content)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.done[f.ID] = state{
		Offset: f.Length, Length: f.Length, Complete: true, MediaType: f.MediaType, Name: f.Name,
		Digest: f.Digest, Size: size, SHA256: sum,
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"id": f.ID, "mediaType": f.MediaType, "digest": f.Digest, "name": f.Name, "length": f.Length,
	})
	return nil
}

func (s *server) faulted(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := map[string]string{}
		for name, values := range r.Header {
			headers[strings.ToLower(name)] = strings.Join(values, ", ")
		}
		at := float64(time.Now().UnixMicro()) / 1000
		s.mu.Lock()
		s.requests = append(s.requests, request{Method: r.Method, Path: r.URL.Path, Headers: headers, At: at})
		token := s.settings.Token
		authorized := token == "" || r.Header.Get("Authorization") == "Bearer "+token
		fault := ""
		if authorized && s.applies(r) && s.fire(s.settings.Fault) {
			fault = s.settings.Fault
			if fault == "drop-append" {
				s.dropped[r.URL.Path+" "+r.Header.Get("Upload-Offset")] = true
			}
		}
		s.mu.Unlock()
		switch {
		case !authorized:
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"type":"about:blank","status":401,"title":"Unauthorized"}`)
		case fault == "unavailable":
			w.WriteHeader(http.StatusServiceUnavailable)
		case fault == "throttled":
			w.WriteHeader(http.StatusTooManyRequests)
		case fault == "stall":
			select {
			case <-r.Context().Done():
			case <-time.After(5 * time.Second):
				w.WriteHeader(http.StatusServiceUnavailable)
			}
		case fault == "garble-offset":
			next.ServeHTTP(garbling{w}, r)
		case fault == "lose-created":
			next.ServeHTTP(losing{w}, r)
		case fault == "drop-append":
			_, _ = io.CopyN(io.Discard, r.Body, max(r.ContentLength/2, 1))
			hangUp(w)
		default:
			next.ServeHTTP(w, r)
		}
	})
}

func (s *server) applies(r *http.Request) bool {
	switch s.settings.Fault {
	case "unavailable", "throttled", "stall":
		return true
	case "lose-created":
		return r.Method == http.MethodPost
	case "drop-append":
		return r.Method == http.MethodPatch && !s.dropped[r.URL.Path+" "+r.Header.Get("Upload-Offset")]
	case "garble-offset":
		return r.Method == http.MethodHead
	}
	return false
}

func (s *server) fire(fault string) bool {
	if fault == "" || s.settings.Fault != fault || s.settings.Count < 1 {
		return false
	}
	s.settings.Count--
	return true
}

type losing struct {
	http.ResponseWriter
}

func (l losing) WriteHeader(status int) {
	if status == http.StatusCreated {
		hangUp(l.ResponseWriter)
		return
	}
	l.ResponseWriter.WriteHeader(status)
}

func (l losing) Unwrap() http.ResponseWriter {
	return l.ResponseWriter
}

type garbling struct {
	http.ResponseWriter
}

func (g garbling) WriteHeader(status int) {
	g.Header().Set("Upload-Offset", "1.5")
	g.ResponseWriter.WriteHeader(status)
}

func hangUp(w http.ResponseWriter) {
	if conn, _, err := http.NewResponseController(w).Hijack(); err == nil {
		_ = conn.Close()
	}
}

func hash(content io.Reader) (int64, string, error) {
	h := sha256.New()
	n, err := io.Copy(h, content)
	return n, hex.EncodeToString(h.Sum(nil)), err
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
