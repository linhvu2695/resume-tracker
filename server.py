#!/usr/bin/env python3
"""Resume tracker -- a local, single-page app over a directory of job applications.

    uv run server.py [port]        # default 8082, bound to 127.0.0.1

This app holds personal data: resume PDFs with your name, phone, email and address.
Unlike the project it borrows its shape from, every mutating endpoint is gated on
the client actually being localhost (`_local_only`) rather than a stub that returns
True -- and there is no BIND override to expose it on a LAN. See README -> Privacy.
"""
import json
import mimetypes
import os
import re
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from lib import pdftext, resumes, store, tailor
from lib.importer import NotAJobPage, import_url

BASE = Path(__file__).resolve().parent
WEB, APPS = BASE / "web", BASE / "applications"
STATE = BASE / "state.json"
MAX_UPLOAD = 25 * 1024 * 1024      # a resume PDF is ~100KB; 25MB is a generous ceiling


def _safe_slug(slug):
    """A slug becomes a path component -- refuse anything that could escape APPS."""
    slug = unquote(slug or "").strip()
    if not slug or "/" in slug or "\\" in slug or slug.startswith(".") or ".." in slug:
        return None
    return slug


def _find(text, term):
    """Case-insensitive search where any whitespace run in `term` matches any whitespace
    run in `text` -- resume lines wrap mid-phrase, so "64K+ community" may span a newline."""
    words = term.split()
    if not words:
        return None
    return re.search(r"\s+".join(map(re.escape, words)), text, re.IGNORECASE)


_SHA = re.compile(r"[0-9a-f]{12}")


def _safe_name(name):
    name = unquote(name or "").strip()
    if not name or "/" in name or "\\" in name or name.startswith(".") or ".." in name:
        return None
    return name


class Handler(BaseHTTPRequestHandler):
    server_version = "resume-tracker"

    # ---------- plumbing ----------
    def _json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            return None
        return self.rfile.read(n) if n else b""

    def _local_only(self):
        """Real gate, not a stub. Everything that writes to disk, spends network, or
        reads personal data goes through here."""
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self._json({"error": "this app is restricted to localhost"}, 403)
            return False
        return True

    def log_message(self, *a):
        pass

    def _file(self, path, ctype=None):
        if not path.is_file():
            return self._json({"error": "not found"}, 404)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(path.name)[0]
                         or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- GET ----------
    def do_GET(self):
        if not self._local_only():
            return
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)

        if p == "/api/applications":
            return self._json(store.load_all())
        if p == "/api/dashboard":
            return self._json(store.dashboard())
        if p == "/api/statuses":
            return self._json({"statuses": store.STATUSES, "open": sorted(store.OPEN_STATUSES)})
        if p == "/api/state":
            try:
                return self._json(json.loads(STATE.read_text() or "{}"))
            except Exception:
                return self._json({})
        if p == "/api/resumes":
            return self._json({"base": resumes.base_sha(), "versions": resumes.versions(store.load_all())})
        if p == "/api/diff":                            # ?a=<sha>&b=<sha>
            a, b = (q.get("a") or [""])[0], (q.get("b") or [""])[0]
            if not (_SHA.fullmatch(a) and _SHA.fullmatch(b)):
                return self._json({"error": "give two resume versions: ?a=<sha>&b=<sha>"}, 400)
            records = store.load_all()
            ta, tb = resumes.text_for(a, records), resumes.text_for(b, records)
            if ta is None or tb is None:
                return self._json({"error": "unknown resume version"}, 404)
            return self._json(resumes.diff(ta, tb))
        if p == "/api/search":
            return self._json(self._search((q.get("q") or [""])[0]))
        if p.startswith("/api/application/") and p.endswith("/tailor"):
            slug = _safe_slug(p[len("/api/application/"):-len("/tailor")])
            if not slug or not store.load(slug):
                return self._json({"error": "unknown application"}, 404)
            jd = store.path_for(slug) / "jd.md"
            return self._json({"result": tailor.load(slug),
                               "ready": {"base": bool(resumes.base_sha()),
                                         "jd": jd.exists() and bool(jd.read_text(encoding="utf-8").strip())},
                               "command": f"/tailor {slug}"})
        if p.startswith("/api/application/"):
            slug = _safe_slug(p[len("/api/application/"):])
            rec = store.load(slug) if slug else None
            if not rec:
                return self._json({"error": "unknown application"}, 404)
            d = store.path_for(slug)
            for key, fn in (("resume_text", "resume.txt"), ("jd", "jd.md")):
                f = d / fn
                rec[key] = f.read_text(encoding="utf-8", errors="replace") if f.exists() else ""
            rec["resume_sha"], rec["base_sha"] = resumes.sha_of_record(rec), resumes.base_sha()
            return self._json(rec)

        # resume PDFs:  /applications/<slug>/<file>.pdf
        if p.startswith("/applications/"):
            parts = [x for x in p[len("/applications/"):].split("/") if x]
            if len(parts) == 2 and _safe_slug(parts[0]) and _safe_name(parts[1]):
                return self._file(APPS / parts[0] / parts[1])
            return self._json({"error": "not found"}, 404)

        if p.startswith("/web/"):
            name = _safe_name(p[len("/web/"):])
            return self._file(WEB / name) if name else self._json({"error": "not found"}, 404)
        if p in ("/", "/pipeline", "/applications", "/resumes", "/home") or "." not in p.rsplit("/", 1)[-1]:
            return self._file(BASE / "app.html", "text/html; charset=utf-8")
        return self._json({"error": "not found"}, 404)

    # ---------- POST ----------
    def do_POST(self):
        if not self._local_only():
            return
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        raw = self._body()
        if raw is None:
            return self._json({"error": "payload too large"}, 413)

        if p == "/api/import":
            try:
                url = (json.loads(raw or b"{}") or {}).get("url", "").strip()
            except Exception:
                return self._json({"error": "bad request"}, 400)
            if not url.startswith(("http://", "https://")):
                return self._json({"error": "give a full http(s) job URL"}, 400)
            try:
                pos = import_url(url)
            except NotAJobPage as e:
                return self._json({"error": str(e)}, 400)
            except Exception as e:
                return self._json({"error": f"could not fetch that URL: {e}"}, 502)
            pos.pop("_server_rendered_chars", None)
            jd = pos.pop("jd", None)
            return self._json({"position": pos, "jd": jd,
                               "existing": store.same_posting(store.load_all(), pos),
                               "note": None if jd else "The job description could not be read "
                                                       "from that page -- paste it into the JD box."})

        if p == "/api/application":                      # create
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                return self._json({"error": "bad request"}, 400)
            pos = body.get("position") or {}
            if not pos.get("title") or not pos.get("company"):
                return self._json({"error": "a title and a company are required"}, 400)
            slug = store.make_slug(pos)
            if (APPS / slug / "data.yaml").exists():
                n = 2
                while (APPS / f"{slug}-{n}" / "data.yaml").exists():
                    n += 1
                slug = f"{slug}-{n}"                     # two applications to one company
            rec = store.new_application(pos)
            status = body.get("status") or "draft"
            if status not in store.STATUSES:
                return self._json({"error": f"status must be one of {store.STATUSES}"}, 400)
            if status != "draft":
                store.set_status(rec, status, date.today())
            store.save(slug, rec)
            if body.get("jd"):
                (APPS / slug / "jd.md").write_text(body["jd"], encoding="utf-8")
            return self._json({"ok": True, "slug": slug})

        if p == "/api/resumes/upload":                 # ?name=<file.pdf>[&base=1], body = PDF
            name = _safe_name((q.get("name") or [""])[0])
            if not name or not name.lower().endswith(".pdf") or not raw.startswith(b"%PDF"):
                return self._json({"error": "upload a .pdf file"}, 400)
            tmp = APPS / f".upload-{os.getpid()}.pdf"
            tmp.write_bytes(raw)
            try:
                res = pdftext.extract(tmp)
            finally:
                tmp.unlink(missing_ok=True)
            if not res.get("readable"):
                return self._json({"error": res["warning"] or "that PDF could not be read"}, 400)
            sha = resumes.add_to_library(raw, name, res["text"])
            if (q.get("base") or [""])[0] == "1":
                resumes.set_meta(sha, base=True)
            return self._json({"ok": True, "sha": sha, "warning": res["warning"]})
        if p.startswith("/api/resumes/"):               # {label} and/or {base: true|false}
            sha = p[len("/api/resumes/"):]
            if not _SHA.fullmatch(sha):
                return self._json({"error": "unknown resume version"}, 404)
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                return self._json({"error": "bad request"}, 400)
            resumes.set_meta(sha, label=body.get("label"), base=body.get("base"))
            return self._json({"ok": True})

        if p == "/api/state":
            try:
                STATE.write_text(json.dumps(json.loads(raw or b"{}"), ensure_ascii=False))
                return self._json({"ok": True})
            except Exception as e:
                return self._json({"error": str(e)}, 400)

        if p.startswith("/api/application/"):
            rest = p[len("/api/application/"):]
            slug, _, action = rest.partition("/")
            slug = _safe_slug(slug)
            if not slug or not store.load(slug):
                return self._json({"error": "unknown application"}, 404)
            if action == "delete":                      # moves to applications/_trash/
                dest = store.delete(slug)
                return self._json({"ok": True, "trash": f"applications/_trash/{dest.name}"})
            if action == "upload":
                return self._upload(slug, q, raw)
            try:
                body = json.loads(raw or b"{}")
            except Exception:
                return self._json({"error": "bad request"}, 400)
            return self._update(slug, action, body)

        return self._json({"error": "not found"}, 404)

    # ---------- handlers ----------
    def _update(self, slug, action, body):
        rec = store.load(slug)
        rec.pop("pdfs", None); rec.pop("has_text", None); rec.pop("has_jd", None); rec.pop("slug", None)
        d = store.path_for(slug)

        if action == "status":
            new = body.get("status")
            if new not in store.STATUSES:
                return self._json({"error": f"status must be one of {store.STATUSES}"}, 400)
            store.set_status(rec, new, date.today())
        elif action == "event":
            text = (body.get("text") or "").strip()
            if not text:
                return self._json({"error": "an event needs text"}, 400)
            rec.setdefault("events", []).append(
                {"on": body.get("on") or store.today(), "type": body.get("type") or "note", "text": text})
        elif action == "jd":
            (d / "jd.md").write_text(body.get("jd") or "", encoding="utf-8")
        elif action == "fields":
            for k in ("follow_up_on", "applied_on", "notes", "status"):
                if k in body:
                    rec[k] = body[k]
            if "position" in body and isinstance(body["position"], dict):
                rec.setdefault("position", {}).update(body["position"])
        else:
            return self._json({"error": "unknown action"}, 404)

        store.save(slug, rec)
        return self._json({"ok": True, "application": store.load(slug)})

    def _upload(self, slug, q, raw):
        name = _safe_name((q.get("name") or [""])[0])
        if not name or not name.lower().endswith(".pdf"):
            return self._json({"error": "give a .pdf filename via ?name="}, 400)
        if not raw.startswith(b"%PDF"):
            return self._json({"error": "that file is not a PDF"}, 400)
        d = store.path_for(slug)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / (name + ".part")
        tmp.write_bytes(raw)

        res = pdftext.extract(tmp)
        if not res.get("readable"):
            # A corrupt file must not replace a good resume or wipe its extracted text.
            tmp.unlink(missing_ok=True)
            return self._json({"error": res["warning"] or "that PDF could not be read"}, 400)
        tmp.replace(d / name)
        (d / "resume.txt").write_text(res["text"], encoding="utf-8")

        rec = store.load(slug)
        rec.pop("pdfs", None); rec.pop("has_text", None); rec.pop("has_jd", None); rec.pop("slug", None)
        rec["resume"] = {"file": name, "pages": res["pages"], "text_ok": res["ok"], "sha": resumes.sha_bytes(raw)}
        rec.setdefault("events", []).append({"on": store.today(), "type": "resume", "text": name})
        store.save(slug, rec)
        return self._json({"ok": True, "extracted_chars": len(res["text"]),
                           "pages": res["pages"], "warning": res["warning"]})

    def _search(self, term):
        term = (term or "").strip().lower()
        if not term:
            return []
        hits = []
        for rec in store.load_all():
            d = store.path_for(rec["slug"])
            hay = {"position": json.dumps(rec.get("position") or {}, ensure_ascii=False)}
            for key, fn in (("resume", "resume.txt"), ("jd", "jd.md")):
                f = d / fn
                if f.exists():
                    hay[key] = f.read_text(encoding="utf-8", errors="replace")
            where = [k for k, v in hay.items() if _find(v, term)]
            if where:
                snippet = ""
                for k in ("resume", "jd"):
                    if k in where:
                        i = _find(hay[k], term).start()
                        snippet = hay[k][max(0, i - 60):i + 120].replace("\n", " ")
                        break
                hits.append({"slug": rec["slug"], "where": where, "snippet": snippet,
                             "title": (rec.get("position") or {}).get("title"),
                             "company": (rec.get("position") or {}).get("company")})
        return hits


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8082))
    APPS.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    n = len(store.all_slugs())
    print(f"Resume tracker  →  http://127.0.0.1:{port}/  (localhost only)")
    print(f"Applications: {n}")
    print("Privacy: this serves resume PDFs. Keep the git remote private.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
