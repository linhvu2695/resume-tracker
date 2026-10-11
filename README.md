# resume-tracker

A self-hosted **job-application tracker**: one web page served by a small Python server.
No build step, no framework, no account, no cloud. Every application is a directory on
disk — the resume PDF you actually sent, the job description, and a `data.yaml` record.

- **Home** — what needs action today: follow-ups due, deadlines closing, applications gone quiet.
- **Applications** — everything you've sent, with full-text search across resumes and JDs.
- **Resumes** — every resume version you've sent, compared against your base resume.
- **New** — one click from a job page (VietnamWorks, TopCV, CareerLink, …) imports the whole
  posting; pick the PDF and save.

The interface is in Vietnamese by default, with a 🇻🇳 / 🇬🇧 flag switch in the header.

## Quick start

### Ask Claude to set it up

If you use Claude Code (or another coding agent), paste this:

> Clone https://github.com/linhvu2695/resume-tracker.git into my projects folder and start
> it by following the "For AI agents starting the app" section of its README. Give me the
> URL when it's up.

The repository is public, so no GitHub access is needed. Everything after that is in the
steps below.

### Do it yourself

Requirements:

- [`uv`](https://docs.astral.sh/uv/). It installs Python and every dependency.
  `curl -LsSf https://astral.sh/uv/install.sh | sh` (or `brew install uv`).
- `make`. Optional; the `uv run` command below does the same job.

```sh
git clone https://github.com/linhvu2695/resume-tracker.git
cd resume-tracker
uv sync      # one-time: creates .venv/ (PyYAML, pypdf, pytest). Seconds, not minutes.
make run     # serves http://127.0.0.1:8082/ and stays in the foreground; Ctrl-C stops it
```

Then open **http://127.0.0.1:8082/**.

- **Different port:** `make run PORT=9000`.
- **Without make:** `uv run server.py 8082`.

### For AI agents starting the app

Use port **8082** unless step 2 says otherwise; call it `<port>` below.

0. **Prerequisites.** If `uv` is missing, ask the user, then install it (`brew install uv`, or the
   curl line above). If `git clone` fails, stop and tell the user rather than retrying.
1. Run `uv sync` in the repo and wait for it to finish (a few seconds — no heavy dependency).
2. **Check the port is free** — otherwise step 4 would report `up` for some *other* program, or
   another copy of this app: `lsof -ti tcp:8082 -sTCP:LISTEN` must print nothing. If it prints
   a pid, pick a free port (e.g. 8090) and use it everywhere below.
3. Start `make run PORT=<port>` as a **background** process. It never exits on its own. On
   startup it logs `Resume tracker  →  http://127.0.0.1:<port>/  (localhost only)`.
4. Wait for it to come up. This prints `up` once the server is serving:
   `curl --retry 30 --retry-connrefused --retry-delay 1 -sf http://127.0.0.1:<port>/api/dashboard >/dev/null && echo up`
5. Give the user the URL: `http://127.0.0.1:<port>/`.
6. To stop it: `kill $(lsof -ti tcp:<port> -sTCP:LISTEN)`. The background `make` then exits
   with code 2 — expected after its child is killed, not a failure.

Harmless on startup: a `VIRTUAL_ENV=... does not match the project environment` warning
(the shell had another virtualenv active; uv ignores it). `uv sync` also installs pytest,
the dev dependency used by `make test`.
Verified 2026-10-11 by a fresh agent following only these steps from a clean clone.

There is **no `BIND` option** and that is deliberate — see [Privacy](#privacy). Do not add one.
Never commit anything from `applications/` or `state.json` — the repository is public. Do not
paste the contents of `applications/` into any external service.

## Using it

### Adding an application

**One-time setup:** open the **New** tab and drag the **＋ Save to tracker** button to your
browser's bookmarks bar.

**Each application:** on a job page from a supported site (below), click **＋ Save to tracker**. The tracker opens
with title, company, location, salary, deadline and the full job description already filled in.
Pick the resume PDF, tick *I have already applied* if you have, and press **Save application**.
Marking an application applied schedules a follow-up 7 days out; an unsent draft counts down
to the posting's deadline on Home.

You can also paste a job URL into the **New** tab and press **Import** — same result.

**Supported sites** (each tested with live marketing listings on 2026-10-11):

| Site | Imports |
|---|---|
| VietnamWorks, TopCV, CareerLink, CareerViet, Vieclam24h, Glints | title, company, location, salary, deadline, full job description |
| Any other site publishing a schema.org `JobPosting` | usually the same — it is the block Google for Jobs reads |
| LinkedIn, Indeed | not fetched: their robots.txt forbids it, and LinkedIn bans tools that copy its pages |
| JobsGO, Cake | not fetched: they block automated requests |

Paste the link of **one job** — a search-results page is refused with a hint. For anything
not supported, use **Fill it in by hand** on the New tab; the rest of the app works the same.

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
| Resume library (base resume, labels) | `applications/_resumes/` |
| Deleted applications | `applications/_trash/` |
| UI preferences | `state.json` |

The PDF keeps a readable filename because you re-attach it from disk, but nothing depends on
it — `data.yaml` is the source of truth. That matters with real Vietnamese company names and
titles containing `/`, `&` and diacritics, which a filename-as-database scheme cannot survive.

**Deleting** an application (button on its page) moves its folder to `applications/_trash/`
with a timestamp — nothing is erased. To restore it, move the folder back and reload.

## Language

The interface is in **Vietnamese** by default; switch to **English** with the 🇬🇧 flag in the
header. Your choice is remembered in this browser. Job titles, descriptions and resumes stay
in whatever language they were written in.

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

## AI tailoring

Suggests how to tailor your **base resume** to one job — then you decide, change by change.

1. Set a base resume (Resumes tab) and make sure the application has its job description.
2. In **Claude Code**, opened in this project folder, run `/tailor <company or job>`
   (the application page shows the exact command).
3. Back on the application page, **AI tailoring** shows:
   - each requirement in the job description as **strong / weak / missing**, with the lines of
     your resume that support it and honest advice for the gaps;
   - every suggested change — reworded lines, moved lines, cuts — each with a checkbox and the
     reason; **Copy tailored resume** copies your base with only the accepted changes;
   - a full **Vietnamese version**.

Guardrails: the AI may reword, reorder and cut, never add. Every number in its output must
already be in your base resume (with the same unit), and unfamiliar names are flagged — the
check runs locally, not by trusting the AI. Only your base resume **with your name, email,
phone, links and @handles removed** and the job description are sent to Claude; the
placeholders are filled back in on your machine. The app never edits your PDF.

## Privacy

**Your applications never enter git.** The code repository is public; your data is not in it.
`applications/` (resume PDFs, extracted text, job records, tailoring results) and `state.json`
are in `.gitignore`, so a clone, a fork or a push never carries them. A resume carries your
full name, phone number, email, often your address and photo, and git history keeps every
version forever — so never force-add anything under `applications/`. **Back up
`applications/` separately** (Time Machine, an encrypted drive) — git will not do it for you.

If you fork this to track your own applications, the same holds: your fork can be public,
your `applications/` folder stays on your machine.

The server binds `127.0.0.1` and every endpoint is gated on the client being localhost.
There is no LAN-exposure flag. If you need to send a resume to an employer, attach the PDF
to an email — do not expose this app.

## Troubleshooting

| Problem | Fix |
|---|---|
| `uv: command not found` | Install uv (Requirements above), then open a new terminal. |
| `Address already in use` | Another copy is running, or the port is taken: `make run PORT=8090`. |
| The page loads but shows an error box | Restart `make run` — `server.py`/`lib/` changes need a restart. |
| Import says "list of jobs" | You pasted a search page; open one job and paste *its* link. |
| Import fails on a supported site | The site changed its page. Fill the job in by hand, and report it. |
| Resume preview is blank | Your browser blocks inline PDFs; use **open ↗** next to the file. |
| "No text layer" warning | The PDF is a scan/image. It still previews; search and compare skip it. |

## Development

```sh
make test     # pytest: importers, store/recommendation logic, PDF extraction, resume diffs
make import URL='<job link>'   # print what a job link imports, without saving anything
```

- `server.py` — HTTP, JSON API, static files, PDF serving. Python stdlib only.
- `lib/store.py` — the on-disk record, slugs, delete-to-trash, the "needs attention" logic.
- `lib/importer.py` — picks the importer for a URL; explains search-results pages.
- `lib/vietnamworks.py` — VietnamWorks (og: meta tags + the Next.js flight payload).
- `lib/jobposting.py` — any page with a schema.org JobPosting (TopCV, CareerLink, …).
- `lib/resumes.py` — resume versions, the base resume, and text diffs.
- `lib/tailor.py` — AI tailoring guardrails: redaction, the honesty check, results.
- `.claude/skills/tailor/` — the `/tailor` skill Claude Code runs.
- `lib/pdftext.py` — PDF text extraction with image-only detection.
- `app.html` + `web/app.js` — the whole frontend, including the Vietnamese strings.
- `CLAUDE.md` — the project guide for agents: data model, conventions, gotchas.

Edits to `app.html` and `web/*.js` show up on the next page load. Restart after changing
`server.py` or `lib/`.
