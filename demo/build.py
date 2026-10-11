"""Build the static live demo of the tracker into demo/dist/ (for Vercel).

    uv run python demo/build.py            # build demo/dist/
    uv run python demo/build.py --serve    # build, then preview on http://127.0.0.1:8095/

The demo is the real app (app.html + web/app.js, unchanged) plus web/demo.js, which answers the
app's API calls in the browser. Its data is *recorded from the real server*: this script builds
a scratch tracker from demo/sample.json, serves it with server.py, and snapshots every response
the app can ask for. So the demo shows exactly what the app produces, and cannot drift from it.

Personal inputs never enter git (the repo is public):
    DEMO_RESUME (default ../portfolio/public/resume.pdf)   the base resume PDF
    demo/private/tailor-work/<key>/tailor/                   /tailor results for sample postings
Everything committed here — postings.json (public job ads), sample.json (fictional statuses),
this script, web/demo.js — contains no personal data. demo/dist/ is gitignored.
"""
import datetime as dt
import html
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server                                    # noqa: E402
from lib import pdftext, resumes, store, tailor  # noqa: E402

DEMO = ROOT / "demo"
DIST = DEMO / "dist"
PRIVATE = DEMO / "private"
RESUME = Path(os.environ.get("DEMO_RESUME", ROOT.parent / "portfolio" / "public" / "resume.pdf"))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def render_pdf(text, out):
    """Tailored text -> a clean one-column resume PDF (headless Chrome), so the demo previews a
    real document. resume.txt keeps the exact text, so diffs stay exact."""
    lines = resumes.logical_lines(text)
    body = []
    for i, ln in enumerate(lines):
        e = html.escape(ln)
        if i == 0:
            body.append(f"<h1>{e}</h1>")
        elif i == 1:
            body.append(f"<p class=contact>{e}</p>")
        elif ln.isupper() and len(ln) < 40:
            body.append(f"<h2>{e}</h2>")
        elif ln[:1] in "●•o" and ln[1:2] == " ":
            body.append(f"<p class='b{' sub' if ln[0] == 'o' else ''}'>{html.escape(ln[2:])}</p>")
        else:
            body.append(f"<p class=line>{e}</p>")
    page = f"""<!doctype html><meta charset=utf-8><style>
      @page {{ size: A4; margin: 14mm 15mm; }}
      body {{ font: 9.6pt/1.38 Helvetica, Arial, sans-serif; color: #111; }}
      h1 {{ font-size: 19pt; margin: 0 0 2pt; letter-spacing: .5pt; }}
      .contact {{ color: #444; margin: 0 0 6pt; }}
      h2 {{ font-size: 10.5pt; letter-spacing: 1pt; color: #0b5cad; border-bottom: 1px solid #c9d6e4; margin: 9pt 0 3pt; padding-bottom: 1pt; }}
      p {{ margin: 1.5pt 0; }} .line {{ font-weight: 600; margin-top: 4pt; }}
      .b {{ padding-left: 11pt; text-indent: -8pt; }} .b::before {{ content: "• "; }}
      .sub {{ padding-left: 22pt; }} .sub::before {{ content: "◦ "; }}
    </style>{''.join(body)}"""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        src = Path(tmp) / "r.html"
        src.write_text(page, encoding="utf-8")
        # Headless Chrome writes the PDF but does not always exit afterwards: wait for a
        # complete file (it ends with %%EOF), then stop it.
        out = Path(out)
        out.unlink(missing_ok=True)
        proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                                 f"--user-data-dir={tmp}/p", f"--print-to-pdf={out}", src.as_uri()],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            for _ in range(600):
                if out.exists() and out.read_bytes().rstrip().endswith(b"%%EOF"):
                    break
                if proc.poll() is not None and not out.exists():
                    sys.exit("Chrome exited without writing the PDF")
                time.sleep(0.1)
            else:
                sys.exit("Chrome did not produce the PDF within 60s")
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)     # Chrome's helper processes too
            except ProcessLookupError:
                pass
            proc.wait()
    return out.read_bytes()


def build_tracker(work, today):
    """A scratch tracker with the sample applications, built through the real store APIs."""
    store.APPS = server.APPS = work
    sample = json.loads((DEMO / "sample.json").read_text(encoding="utf-8"))
    postings = json.loads((DEMO / "postings.json").read_text(encoding="utf-8"))["postings"]
    if not RESUME.exists():
        sys.exit(f"base resume not found: {RESUME} (set DEMO_RESUME)")
    day = lambda off: today + dt.timedelta(days=off)

    base_text = pdftext.extract(RESUME)["text"]
    base_sha = resumes.add_to_library(RESUME.read_bytes(), "Vu_Viet_Linh_Resume_2026.pdf", base_text)
    resumes.set_meta(base_sha, base=True, label=sample["base_label"])
    version = {"base": ("Vu_Viet_Linh_Resume_2026.pdf", RESUME.read_bytes(), base_text)}
    for v in sample["versions"]:
        tdir = PRIVATE / "tailor-work" / v["from_tailoring"] / "tailor"
        result = json.loads((tdir / "result.json").read_text(encoding="utf-8"))
        mapping = json.loads((tdir / "redaction.json").read_text(encoding="utf-8"))
        text = tailor.restore(result["tailored"], mapping)
        pdf = render_pdf(text, work / f"{v['key']}.pdf")
        name = f"Vu_Viet_Linh_Resume_2026_{v['key']}.pdf"
        sha = resumes.add_to_library(pdf, name, text)
        resumes.set_meta(sha, label=v["label"])
        version[v["key"]] = (name, pdf, text)

    for a in sample["applications"]:
        p = postings[a["posting"]]
        rec = store.new_application(dict(p["position"]))
        rec["created_on"] = day(a["created"]).isoformat()
        rec["events"] = [{"on": rec["created_on"], "type": "created"}]
        name, pdf, text = version[a["resume"]]
        slug = store.make_slug(rec["position"])
        d = store.save(slug, rec)
        (d / name).write_bytes(pdf)
        (d / "resume.txt").write_text(text, encoding="utf-8")
        (d / "jd.md").write_text(p["jd"] or "", encoding="utf-8")
        rec["resume"] = {"file": name, "pages": 1, "text_ok": True, "sha": resumes.sha_bytes(pdf)}
        rec["events"].append({"on": rec["created_on"], "type": "resume", "text": name})
        store.set_status(rec, "applied", day(a["applied"]))
        for off, status in a["steps"]:
            store.set_status(rec, status, day(off))
        for off, text_ in a["notes"]:
            rec["events"].append({"on": day(off).isoformat(), "type": "note", "text": text_})
        rec["events"].sort(key=lambda e: e["on"])
        store.save(slug, rec)
        if a.get("tailoring"):
            src = PRIVATE / "tailor-work" / a["tailoring"] / "tailor"
            shutil.copytree(src, d / "tailor")
            meta = json.loads((d / "tailor" / "meta.json").read_text())
            meta["base_sha"], meta["prepared_at"] = base_sha, day(a["created"] + 1).isoformat() + "T10:00:00"
            (d / "tailor" / "meta.json").write_text(json.dumps(meta))
    return sample, postings


def record(today):
    """Serve the scratch tracker with the real server and snapshot what the app requests."""
    srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    get = lambda path: json.load(urllib.request.urlopen(base + path, timeout=30))
    apps = get("/api/applications")
    data = {
        "built_on": today.isoformat(),
        "applications": {a["slug"]: get(f"/api/application/{a['slug']}") for a in apps},
        "tailor": {a["slug"]: get(f"/api/application/{a['slug']}/tailor") for a in apps},
        "resumes": get("/api/resumes"),
        "statuses": get("/api/statuses"),
        "dashboard_at_build": get("/api/dashboard"),
    }
    shas = [v["sha"] for v in data["resumes"]["versions"]]
    data["diffs"] = {f"{a}|{b}": get(f"/api/diff?a={a}&b={b}") for a in shas for b in shas if a != b}
    srv.shutdown()
    return data


def build():
    today = dt.date.today()
    link = DIST / ".vercel"                       # keep the Vercel project link across rebuilds
    kept = Path(tempfile.mkdtemp()) / ".vercel"
    if link.is_dir():
        shutil.move(str(link), kept)
    shutil.rmtree(DIST, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "applications"
        work.mkdir()
        server.STATE = Path(tmp) / "state.json"
        sample, postings = build_tracker(work, today)
        data = record(today)
        data["github"] = sample["github"]
        data["postings"] = postings
        data["importable"] = sample["importable"]
        (DIST / "web").mkdir(parents=True)
        for p in work.rglob("*.pdf"):
            rel = p.relative_to(work)
            if len(rel.parts) == 2:                         # applications/<slug or _resumes>/<file>.pdf
                (DIST / "applications" / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(p, DIST / "applications" / rel)
    (DIST / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    shutil.copy(ROOT / "web" / "app.js", DIST / "web" / "app.js")
    shutil.copy(DEMO / "demo.js", DIST / "web" / "demo.js")
    page = (ROOT / "app.html").read_text(encoding="utf-8")
    page = page.replace('<script src="/web/app.js"></script>',
                        '<script src="/web/demo.js"></script>\n<script src="/web/app.js"></script>')
    page = page.replace("<title>Resume Tracker</title>", "<title>Resume Tracker — live demo</title>")
    assert "/web/demo.js" in page
    if kept.is_dir():
        shutil.move(str(kept), link)
    for name in ("index.html", "app.html"):
        (DIST / name).write_text(page, encoding="utf-8")
    shutil.copy(DEMO / "vercel.json", DIST / "vercel.json")
    n = len(data["applications"])
    print(f"built {DIST} — {n} applications, {len(data['resumes']['versions'])} resume versions, "
          f"{len(data['diffs'])} diffs, {sum(1 for f in DIST.rglob('*') if f.is_file())} files")


class _SPA(SimpleHTTPRequestHandler):
    """Local preview: files as-is, every other path -> index.html (what vercel.json does)."""
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(DIST), **k)

    def send_head(self):
        if not (DIST / self.path.split("?")[0].lstrip("/")).is_file():
            self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        print("preview: http://127.0.0.1:8095/")
        ThreadingHTTPServer(("127.0.0.1", 8095), _SPA).serve_forever()
