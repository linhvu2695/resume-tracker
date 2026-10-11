"""AI resume tailoring: everything around the AI step, which runs in Claude Code (/tailor).

    uv run python -m lib.tailor find <words>     which application? (slug from company/title)
    uv run python -m lib.tailor prepare <slug>   write the redacted inputs for the AI
    uv run python -m lib.tailor check <slug>     validate the AI's result.json

Files, all under applications/<slug>/tailor/ (gitignored with the rest of applications/):

    input/base.md       the base resume, contact details replaced by [NAME] [EMAIL_1] ...
    input/jd.md         the job description
    input/job.json      title + company
    input/schema.json   the shape result.json must have
    redaction.json      placeholder -> real value. NEVER sent: it is what redaction removed.
    result.json         written by the AI: gaps, tailored text, notes, Vietnamese version

Two guardrails live here because they must not depend on the AI behaving:
  * redact()         what leaves the machine has no name, email, phone, links or @handles;
  * unknown_facts()  every number in the AI's text must already be in the base resume, and
                     unfamiliar names are flagged -- tailoring may reword, never invent.
"""
import datetime as _dt
import json
import re
import sys
import unicodedata

from lib import resumes, store


class NotReady(ValueError):
    """The application lacks what tailoring needs. The message is user-facing."""


STRENGTHS = ("strong", "weak", "missing")
RESULT_SCHEMA = {
    "type": "object",
    "required": ["summary", "gaps", "tailored", "notes", "tailored_vi"],
    "properties": {
        "summary": {"type": "string", "description": "2-3 sentences: the angle this version takes for this job."},
        "gaps": {"type": "array", "items": {
            "type": "object", "required": ["requirement", "strength", "evidence", "advice"],
            "properties": {
                "requirement": {"type": "string", "description": "One requirement from the job description, in its own language."},
                "strength": {"enum": list(STRENGTHS)},
                "evidence": {"type": "array", "items": {"type": "string"},
                             "description": "Lines quoted verbatim from the base resume. Empty when missing."},
                "advice": {"type": "string", "description": "What to emphasise; for 'missing', how to address it honestly (cover letter, interview) -- never by inventing."}}}},
        "tailored": {"type": "string", "description": "The whole tailored resume, one logical line per heading/role/bullet, placeholders kept exactly."},
        "notes": {"type": "array", "items": {
            "type": "object", "required": ["line", "requirement", "why"],
            "properties": {"line": {"type": "string"}, "requirement": {"type": "string"}, "why": {"type": "string"}}}},
        "tailored_vi": {"type": "string", "description": "The tailored resume in natural, professional Vietnamese; placeholders, numbers and brand names unchanged."},
    },
}

# ---- redaction ----------------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_LINK = re.compile(r"(?:https?://)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*"
                   r"\.(?:com|vn|app|io|me|net|org|dev|page|site|info|co|link|bio)\b(?:/[^\s·,;)]*)?", re.I)
_PHONE = re.compile(r"(?<![\w.])(?:\+84|0)[\s.-]?(?:\d[\s.-]?){8,9}\d(?![\w])|(?<![\w.])\+\d{1,3}[\s.-]?(?:\d[\s.-]?){6,12}\d(?![\w])")
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,}[A-Za-z0-9_]")
_PLACEHOLDER = re.compile(r"\[(?:NAME|EMAIL_\d+|PHONE_\d+|LINK_\d+|HANDLE_\d+)\]")


def _name_line(text):
    for ln in text.splitlines():
        ln = ln.strip()
        if ln:
            words = ln.split()
            return ln if 1 <= len(words) <= 5 and all(re.fullmatch(r"[^\W\d_]+\.?", w) for w in words) else None
    return None


def redact(text):
    """-> (redacted text, {placeholder: original}). The same value always gets the same
    placeholder, so restore() is exact."""
    mapping, seen, counts = {}, {}, {}

    def ph(kind, value):
        if value not in seen:
            counts[kind] = counts.get(kind, 0) + 1
            seen[value] = f"[{kind}_{counts[kind]}]"
            mapping[seen[value]] = value
        return seen[value]

    out = text
    name = _name_line(text)
    if name:
        mapping["[NAME]"] = name
        out = re.sub(re.escape(name), "[NAME]", out, flags=re.I)
    # order matters: an email contains an @handle-looking part and a link-looking domain
    for kind, rx in (("EMAIL", _EMAIL), ("PHONE", _PHONE), ("LINK", _LINK), ("HANDLE", _HANDLE)):
        out = rx.sub(lambda m, k=kind: ph(k, m.group(0)), out)
    return out, mapping


def restore(text, mapping):
    for key in sorted(mapping, key=len, reverse=True):     # [EMAIL_10] before [EMAIL_1]
        text = (text or "").replace(key, mapping[key])
    return text


# ---- the honesty check --------------------------------------------------------------

_NUMBER = re.compile(r"\d+(?:[.,]\d+)*(?:\s?%|[KkMmBb]\+?|\+)?")
_NAME = re.compile(r"\b[A-Z][\w&'’.-]*[a-z][\w]*\b")
_SENTENCE_START = re.compile(r"(?:^|[.!?:;•·\-–—]\s+|^\s*[-•*]\s*)$")


def _fold(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").replace("đ", "d").replace("Đ", "D").lower()


def _core(num):
    """-> (value, unit). '12,000' == '12.000' == '12000'; '2,8M' == '2.8M'; unit is
    '%', 'k', 'm', 'b' or '' (a bare number, which may match any unit in the base)."""
    unit = "%" if "%" in num else (re.search(r"[KkMmBb]", num) or [""])[0].lower()
    n = re.sub(r"[\s%+KkMmBb]", "", num)
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", n):
        return n.replace(",", "").replace(".", ""), unit
    return n.replace(",", "."), unit


def unknown_facts(base, text, allowed=""):
    """Numbers in `text` that are not in `base` (error), and capitalised names that appear
    in neither `base` nor `allowed` (warn -- may be legitimate wording, worth a look)."""
    clean = _PLACEHOLDER.sub(" ", text or "")
    base_facts = {_core(m.group(0)) for m in _NUMBER.finditer(_PLACEHOLDER.sub(" ", base))}
    base_values = {v for v, _ in base_facts}
    known = _fold(base + " " + (allowed or ""))
    out = []
    for m in _NUMBER.finditer(clean):
        value, unit = _core(m.group(0))
        if (value, unit) not in base_facts if unit else value not in base_values:
            out.append({"fact": m.group(0).strip(), "level": "error", "kind": "number", "at": m.start()})
    for m in _NAME.finditer(clean):
        word = m.group(0).rstrip(".")
        if _SENTENCE_START.search(clean[:m.start()]) or word.isupper():
            continue                       # sentence-initial capitals and acronyms are not names
        if not re.search(r"(?<!\w)" + re.escape(_fold(word)) + r"(?!\w)", known):
            out.append({"fact": word, "level": "warn", "kind": "name", "at": m.start()})
    out.sort(key=lambda p: p.pop("at"))
    return out


def _norm(s):
    return " ".join((s or "").split())


def validate(result, base, jd=""):
    """Problems in an AI result: [{level: error|warn, where, message}]. Errors block display
    as 'checked'; warnings are shown next to the line."""
    P = []
    add = lambda level, where, msg: P.append({"level": level, "where": where, "message": msg})
    if not isinstance(result, dict):
        return [{"level": "error", "where": "result", "message": "result.json is not a JSON object"}]
    for key, typ in (("summary", str), ("gaps", list), ("tailored", str), ("notes", list), ("tailored_vi", str)):
        if not isinstance(result.get(key), typ) or (typ is str and not result[key].strip() and key != "summary"):
            add("error", key, f"'{key}' is missing or not a {typ.__name__}")
    base_lines = {_norm(ln) for ln in resumes.logical_lines(base)}
    for i, g in enumerate(result.get("gaps") or []):
        if not isinstance(g, dict) or not isinstance(g.get("requirement"), str):
            add("error", "gaps", f"gap {i + 1} has no requirement"); continue
        if g.get("strength") not in STRENGTHS:
            add("error", "gaps", f"gap {i + 1}: strength must be one of {', '.join(STRENGTHS)}, not {g.get('strength')!r}")
        for ev in g.get("evidence") or []:
            if _norm(ev) not in base_lines and _norm(ev) not in _norm(base):
                add("warn", "gaps", f"gap {i + 1}: evidence is not quoted verbatim from the base resume: {ev[:80]}")
    placeholders = sorted(set(_PLACEHOLDER.findall(base)))
    for key in ("tailored", "tailored_vi"):
        text = result.get(key) if isinstance(result.get(key), str) else ""
        if not text:
            continue
        for ph in placeholders:
            if ph not in text:
                add("error", key, f"{ph} was removed -- placeholders must stay exactly as they are")
        new_lines = [ln for ln in resumes.logical_lines(text) if _norm(ln) not in base_lines]
        for ln in new_lines:
            for f in unknown_facts(base, ln, allowed=jd):
                if key == "tailored_vi" and f["kind"] == "name":
                    continue                # translated prose capitalises differently
                what = "number" if f["kind"] == "number" else "name"
                add(f["level"], key, f"{what} “{f['fact']}” is not in your base resume: {ln[:100]}")
    return P


# ---- files --------------------------------------------------------------------------

def _dir(slug):
    return store.path_for(slug) / "tailor"


def prepare(slug):
    rec = store.load(slug)
    if not rec:
        raise NotReady("Unknown application.")
    sha = resumes.base_sha()
    base = resumes.text_for(sha, store.load_all()) if sha else None
    if not base:
        raise NotReady("Set a base resume on the Resumes tab first -- tailoring starts from it.")
    jd_file = store.path_for(slug) / "jd.md"
    jd = jd_file.read_text(encoding="utf-8").strip() if jd_file.exists() else ""
    if not jd:
        raise NotReady("This application has no job description yet -- add it on its page first.")
    red, mapping = redact(base)
    d = _dir(slug)
    (d / "input").mkdir(parents=True, exist_ok=True)
    pos = rec.get("position") or {}
    files = {"base": d / "input" / "base.md", "jd": d / "input" / "jd.md",
             "job": d / "input" / "job.json", "schema": d / "input" / "schema.json"}
    files["base"].write_text(red, encoding="utf-8")
    files["jd"].write_text(jd, encoding="utf-8")
    files["job"].write_text(json.dumps({"title": pos.get("title"), "company": pos.get("company")}, ensure_ascii=False, indent=1), encoding="utf-8")
    files["schema"].write_text(json.dumps(RESULT_SCHEMA, ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "redaction.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "meta.json").write_text(json.dumps({"base_sha": sha, "prepared_at": _dt.datetime.now().isoformat(timespec="seconds")}), encoding="utf-8")
    return {k: str(v) for k, v in files.items()} | {"result": str(d / "result.json")}


def _read(slug):
    d = _dir(slug)
    red = (d / "input" / "base.md").read_text(encoding="utf-8")
    jd = (d / "input" / "jd.md").read_text(encoding="utf-8")
    mapping = json.loads((d / "redaction.json").read_text(encoding="utf-8"))
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    return d, red, jd, mapping, meta


def check(slug):
    d, red, jd, _, _ = _read(slug)
    try:
        result = json.loads((d / "result.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [{"level": "error", "where": "result", "message": f"{d / 'result.json'} does not exist yet"}]
    except ValueError as e:
        return [{"level": "error", "where": "result", "message": f"result.json is not valid JSON: {e}"}]
    return validate(result, red, jd)


def load(slug):
    """What the app shows: the result with real contact details restored, its problems, and
    the diff from the base. None when tailoring has not been run for this application."""
    d = _dir(slug)
    if not (d / "result.json").exists() or not (d / "redaction.json").exists():
        return None
    _, red, jd, mapping, meta = _read(slug)
    try:
        r = json.loads((d / "result.json").read_text(encoding="utf-8"))
    except ValueError as e:
        return {"problems": [{"level": "error", "where": "result", "message": f"result.json is not valid JSON: {e}"}]}
    back = lambda s: restore(s, mapping) if isinstance(s, str) else s
    base = restore(red, mapping)
    tailored = back(r.get("tailored") or "")
    return {
        "summary": back(r.get("summary")),
        "gaps": [dict(g, evidence=[back(e) for e in g.get("evidence") or []]) for g in r.get("gaps") or [] if isinstance(g, dict)],
        "notes": [dict(n, line=back(n.get("line"))) for n in r.get("notes") or [] if isinstance(n, dict)],
        "tailored": tailored, "tailored_vi": back(r.get("tailored_vi") or ""), "base": base,
        "diff": resumes.diff(base, tailored),
        "problems": validate(r, red, jd),
        "base_sha": meta.get("base_sha"), "stale": meta.get("base_sha") != resumes.base_sha(),
        "prepared_at": meta.get("prepared_at"),
    }


def find(words):
    q = _fold(" ".join(words))
    hits = []
    for r in store.load_all():
        pos = r.get("position") or {}
        hay = _fold(" ".join([r["slug"], pos.get("title") or "", pos.get("company") or ""]))
        if all(w in hay for w in q.split()):
            hits.append((r["slug"], pos.get("title"), pos.get("company"), r.get("status")))
    return hits


if __name__ == "__main__":
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if cmd == "find":
        for slug, title, company, status in find(args):
            print(f"{slug}\t{title} — {company} [{status}]")
    elif cmd == "prepare" and args:
        try:
            print(json.dumps(prepare(args[0]), indent=1))
        except NotReady as e:
            sys.exit(f"not ready: {e}")
    elif cmd == "check" and args:
        problems = check(args[0])
        for p in problems:
            print(f"{p['level'].upper():5} {p['where']}: {p['message']}")
        errors = sum(p["level"] == "error" for p in problems)
        print(f"{errors} error(s), {len(problems) - errors} warning(s)")
        sys.exit(1 if errors else 0)
    else:
        sys.exit(__doc__)
