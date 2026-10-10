# Project guide

A local job-application tracker. Read `README.md` first for how to run it; this file is the
part an agent needs to *change* it safely.

## Ground rules

1. **This repo holds personal data.** Resume PDFs with a real name, phone, email, address.
   Never push to a public remote, never paste `applications/**` into an external service,
   never add a flag that binds the server to anything but `127.0.0.1`.
2. **No build step, no framework, no runtime npm.** The frontend is one HTML file and one
   JS file, served as-is. Keep it that way — it is the reason this app starts in a second.
3. **Dependencies are PyYAML and pypdf.** Adding a third needs a real reason.

## The data model

One directory per application. The directory *is* the record:

```
applications/<slug>/
    data.yaml       the record
    <name>.pdf      the resume actually sent (readable name, but nothing depends on it)
    resume.txt      auto-extracted on upload; powers search
    jd.md           the job description, pasted by hand
```

`slug` = `<YYYY-MM>-<company>-<title>`, ASCII-folded (`lib/store.py:make_slug`). Collisions
get a `-2` suffix, because applying to the same company twice is normal.

`data.yaml` keys: `status`, `created_on`, `applied_on`, `follow_up_on`, `position`,
`resume`, `events[]`, `contacts[]`, `notes`.

`status` ∈ `draft | applied | screening | interview | offer | rejected | withdrawn`.
`OPEN_STATUSES` (draft/applied/screening/interview) is what "open" and "needs attention" mean.

## The recommendation primitive — reuse it, don't rebuild

`store.needs_attention(rec, as_of)` returns a reason string or `None`, and
`store.dashboard(records, as_of)` aggregates. Precedence: overdue follow-up → unsent draft →
no movement in `STALE_AFTER_DAYS` (10). Closed statuses never nag.

**Always thread `as_of` through** — never call `date.today()` inside this layer. That was a
real bug: follow-ups honored the passed date while staleness read the clock, which made the
dashboard untestable and wrong. `days_since(iso, as_of)` takes the date for the same reason.

## Gotchas

- **VietnamWorks serves decomposed Unicode.** `tuyển` arrives as `e` + combining marks, not
  U+1EC3, so literal patterns silently miss. Everything crossing that boundary goes through
  `vietnamworks._nfc`. A fixture written in NFC will pass while the live site fails — which is
  exactly what happened. `tests/test_vietnamworks.py` has an explicit decomposed-input test.
- **The `$` in a VietnamWorks salary is not a currency.** `$15000000` is VND, `$100` is USD.
  Inferred from magnitude in `parse_salary`. Four shapes exist: range, `Từ X`, negotiable, empty.
- **The job description is not importable.** The page is a client-rendered SPA; a fetch returns
  ~100 characters of body text. Do not "fix" this with a headless browser without asking.
- **Image-only PDFs extract to nothing.** `pdftext.extract` flags it (`ok: False` + warning)
  rather than storing an empty string. Keep that distinction — silently empty is worse.
- **`_local_only()` is a real check.** It is not a stub that returns `True`. Do not weaken it.
- **Slugs become path components.** `server._safe_slug` / `_safe_name` reject traversal. Any
  new path-taking endpoint must use them.
- **Writes are atomic.** `store.save` writes `data.yaml.tmp` then renames. Keep that.

## Testing

`make test` runs pytest. The importer is tested offline from fixtures; the store's
recommendation logic is tested against fixed dates. If you touch either, the tests should
fail before they pass.
