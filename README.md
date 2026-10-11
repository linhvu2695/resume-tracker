# resume-tracker

A self-hosted **job-application tracker**: one web page served by a small Python server.
No build step, no framework, no account, no cloud. Every application is a directory on
disk — the resume PDF you actually sent, the job description, and a `data.yaml` record.

- **Home** — what needs action today: follow-ups due, applications that have gone quiet.
- **Applications** — everything you've sent, with full-text search across resumes and JDs.
- **New** — one click from a VietnamWorks job page imports the whole posting; pick the PDF and save.

## Quick start

Requirements:

- [`uv`](https://docs.astral.sh/uv/). It installs Python and every dependency.
  `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`).
- `make`. Optional; the `uv run` command below does the same job.

```sh
uv sync      # one-time: creates .venv/ with PyYAML + pypdf. Seconds, not minutes.
make run     # serves http://127.0.0.1:8082/ and stays in the foreground; Ctrl-C stops it
```

Then open **http://127.0.0.1:8082/**.

- **Different port:** `make run PORT=9000`.
- **Without make:** `uv run server.py 8082`.

### For AI agents starting the app

1. Run `uv sync` and wait for it to finish (a few seconds — there is no heavy dependency).
2. Start `make run` as a **background** process. It never exits on its own. On startup it logs
   `Resume tracker  →  http://127.0.0.1:8082/  (localhost only)`.
3. Wait for it to come up. This prints `up` once the server is serving:
   `curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://127.0.0.1:8082/api/dashboard >/dev/null && echo up`
4. Give the user the URL: http://127.0.0.1:8082/.
5. To stop it, kill that background process. If 8082 is taken, use `make run PORT=<free port>`.

There is **no `BIND` option** and that is deliberate — see [Privacy](#privacy). Do not add one.
Do not commit anything to a public remote. Do not paste the contents of `applications/`
into any external service.

## Using it

### Adding an application

**One-time setup:** open the **New** tab and drag the **＋ Save to tracker** button to your
browser's bookmarks bar.

**Each application:** on a VietnamWorks job page, click **＋ Save to tracker**. The tracker opens
with title, company, location, salary, deadline and the full job description already filled in.
Pick the resume PDF, tick *I have already applied* if you have, and press **Save application**.
Marking an application applied schedules a follow-up 7 days out; an unsent draft counts down
to the posting's deadline on Home.

You can also paste a job URL into the **New** tab and press **Import** — same result.

Non-VietnamWorks URLs are not parsed yet — fill the form in by hand and it works the same.

### A note on salaries

VietnamWorks prints a `$` in front of VND amounts. The symbol is not trustworthy, so the
currency is inferred from magnitude: `$15000000` is read as 15M VND, `$100 - $150` as USD.
All four observed shapes are handled — range, `Từ X` (open-ended), negotiable, and missing.

### Resume text extraction

When you attach a PDF, its text is extracted to `resume.txt` next to it. That is what powers
search and, later, tailoring. Resumes exported from Word, Google Docs or Canva extract cleanly.
A **scanned or image-based** PDF has no text layer: the app tells you so rather than silently
storing nothing. The PDF itself still works fine for preview and re-sending.

### Your data

| What | Where |
|---|---|
| An application | `applications/<slug>/data.yaml` |
| The resume you sent | `applications/<slug>/<name>.pdf` |
| Extracted resume text | `applications/<slug>/resume.txt` |
| The job description | `applications/<slug>/jd.md` |
| UI preferences | `state.json` |

The PDF keeps a readable filename because you re-attach it from disk, but nothing depends on
it — `data.yaml` is the source of truth. That matters with real Vietnamese company names and
titles containing `/`, `&` and diacritics, which a filename-as-database scheme cannot survive.

## Comparing resumes

Each application keeps the exact PDF you sent. The **Resumes** tab groups them into
*versions* — the same file sent to several employers is one version — and shows which
applications used each one and how far they got.

1. Upload your **base resume** (the master you tailor from) on the Resumes tab, or mark an
   existing version as the base.
2. Every application page then shows **Tailored for this job**: what its resume changed
   versus the base, changed words highlighted.
3. **Compare** any two versions side by side from the Resumes tab.

Comparison runs on the extracted text, so it needs PDFs with a text layer (see above).

## Privacy

**Your applications never enter git.** `applications/` (resume PDFs, extracted text, job
records) and `state.json` are in `.gitignore`. A resume carries your full name, phone number,
email, often your address and photo; git history keeps every version forever, even after the
file is deleted, and even a private remote is one settings change away from public. So the
remote holds only the code. **Back up `applications/` separately** (Time Machine, an
encrypted drive) — git will not do it for you.

Keep the remote private anyway. Do not force-add anything under `applications/`.

The server binds `127.0.0.1` and every endpoint is gated on the client being localhost.
There is no LAN-exposure flag. If you need to send a resume to an employer, attach the PDF
to an email — do not expose this app.

## Development

```sh
make test     # pytest: importer, store/recommendation logic, PDF extraction
```

- `server.py` — HTTP, JSON API, static files, PDF serving. Python stdlib only.
- `lib/store.py` — the on-disk record, slugs, and the "needs attention" logic.
- `lib/vietnamworks.py` — the job importer (og: meta tags + Unicode normalization).
- `lib/pdftext.py` — PDF text extraction with image-only detection.
- `app.html` + `web/app.js` — the whole frontend.
- `CLAUDE.md` — the project guide for agents: data model, conventions, gotchas.

Edits to `app.html` and `web/*.js` show up on the next page load. Restart after changing
`server.py` or `lib/`.
