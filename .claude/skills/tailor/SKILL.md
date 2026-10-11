---
name: tailor
description: Tailor the base resume to one job application in this resume tracker — gap analysis against the job description, suggested edits that never invent facts, and a Vietnamese version. Use when the user says "/tailor", "tailor my resume for <company/job>", "chỉnh CV cho <công ty>", or asks which requirements of a job their resume covers.
---

# Tailor a resume to a job

You produce `applications/<slug>/tailor/result.json` for one application. The app then shows it
on that application's page, where the user accepts or rejects each change. You never edit the
resume PDF, the base resume, or any record.

## 1. Find the application

```sh
uv run python -m lib.tailor find <words from the user's request>
```

Exactly one hit → use its slug. Several → ask which one. None → list recent ones with
`uv run python -m lib.tailor find ""` and ask.

## 2. Prepare the inputs

```sh
uv run python -m lib.tailor prepare <slug>
```

If it prints `not ready: ...`, tell the user that message and stop.

## 3. Read only the prepared inputs

Read exactly these four files under `applications/<slug>/tailor/input/`:
`base.md`, `jd.md`, `job.json`, `schema.json`.

**Do not open anything else under `applications/`** — not the PDFs, `resume.txt`,
`redaction.json`, or other applications. `base.md` has the user's name, email, phone, links and
@handles replaced by placeholders (`[NAME]`, `[EMAIL_1]`, …); the user agreed to share the resume
only in that form. Placeholders are restored locally by the app.

## 4. Write `result.json`

The shape is in `schema.json`. Content rules — these are what make the result trustworthy:

**gaps** — 5 to 10 real requirements from the job description, in the JD's own language.
- `strong`: the base resume shows it directly; `weak`: related or partial evidence;
  `missing`: nothing in the base supports it.
- `evidence`: lines copied **verbatim** from `base.md` (empty for `missing`).
- `advice`: what to lead with; for `missing`, how to address it honestly (cover letter, a
  short course, an interview story) — never by adding it to the resume.

**tailored** — the whole resume, rewritten for this job, starting from `base.md`. You may:
- rewrite the headline line and the profile summary to target this role;
- reorder roles' bullets so the most relevant come first, and reorder sections;
- reword bullets to use the job description's vocabulary *where the base supports it*;
- cut bullets (or whole minor roles) that do not help for this job.

You may **not**:
- add any fact that is not in `base.md`: no new numbers, employers, job titles, dates, tools,
  platforms, skills, certifications or achievements — rewording is fine, inventing is not;
- change any number — keep it exactly as written (`2.8M`, not `2.8 million`);
- change a role's title, employer or dates;
- touch placeholders — every `[NAME]`, `[EMAIL_1]`, … stays exactly once, unchanged.

Format: plain text, one line per heading, role line and bullet (no line wrapping), bullets
start with `• `, section headings in CAPITALS as in the base. Not longer than the base.

**notes** — one entry per line you changed or moved: the new `line` (verbatim from
`tailored`), the `requirement` it serves, and `why` in one short sentence. Write `why` in the
language the user is talking to you in.

**tailored_vi** — `tailored` in natural, professional Vietnamese, as a Vietnamese recruiter
would expect. Keep placeholders, every number, brand and product names, and widely used English
terms (KOC, KPI, TikTok Shop, GMV) unchanged.

**summary** — 2–3 sentences: the angle this version takes for this job, in the user's language.

Write the file as UTF-8 JSON with real Vietnamese characters (not `\u` escapes):
`applications/<slug>/tailor/result.json`.

## 5. Check, and fix until clean

```sh
uv run python -m lib.tailor check <slug>
```

- **ERROR** lines must all be fixed: a number not in the base means you changed or invented it
  — restore the original; a removed placeholder must be put back; schema errors as stated.
- **WARN** lines flag names not found in the base resume or JD. If the name came from the base
  (different spelling) or the JD, leave it; otherwise remove it.

Re-run `check` until it reports `0 error(s)`.

## 6. Tell the user

Two or three lines: the angle (summary), how many requirements are strong / weak / missing,
and where to review: the application's page in the tracker — `http://127.0.0.1:8082/a/<slug>`
(the port may differ if they started it on another) — section **AI tailoring**, where they
accept or reject each change and copy the result into their resume document.
