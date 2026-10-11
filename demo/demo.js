/* Live-demo backend, in the browser. Loaded before web/app.js only in the demo build
   (demo/build.py); the real app never includes it.

   The app talks to /api/* exactly as it does locally. This file answers those requests from
   data.json — responses recorded from the real server at build time — and keeps a visitor's
   changes in localStorage, so every visitor gets a private sandbox. A few server rules are
   re-implemented here so edits behave like the real app: set_status (lib/store.py),
   needs_attention + dashboard (lib/store.py), _find search (server.py). Keep them in step. */
'use strict';
(() => {
  const KEY = 'rt-demo-v1';
  const OPEN = new Set(['draft', 'applied', 'screening', 'interview']);
  const PIPELINE = ['draft', 'applied', 'screening', 'interview', 'offer'];
  const STATUSES = ['draft', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'];
  try { if (!localStorage.getItem('rt-lang')) localStorage.setItem('rt-lang', 'en'); } catch { /* blocked storage */ }

  /* ---------- dates: the recording is shifted so "applied 5 days ago" stays true ---------- */
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = new Date(s.slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d) + s.slice(10); };
  const between = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a.slice(0, 10) + 'T00:00:00')) / 864e5);
  const shift = (v, n) => typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v) ? addDays(v, n) : v)
    : Array.isArray(v) ? v.map(x => shift(x, n)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, n)])) : v;

  let data = null, state = null;
  const ready = fetch('/data.json').then(r => r.json()).then(d => {
    const n = between(d.built_on, today());
    data = shift(d, n);
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.built_on === d.built_on) state = saved;
    } catch { /* fall through to a fresh sandbox */ }
    if (!state) state = { built_on: d.built_on, apps: structuredClone(data.applications), labels: {}, base: data.resumes.base };
  });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* sandbox lasts for this page only */ } };
  const vi = () => typeof LANG !== 'undefined' && LANG === 'vi';
  const say = (en, vn) => (vi() ? vn : en);

  /* ---------- the server's rules, as used by edits ---------- */
  const setStatus = (rec, s, on) => {
    if (s !== rec.status) rec.events.push({ on, type: 'status', from: rec.status, to: s });
    if (s !== 'applied' && s !== 'draft' && rec.status === 'applied') rec.follow_up_on = null;   // they replied
    rec.status = s;
    if (s === 'applied') {
      rec.applied_on = rec.applied_on || on;
      rec.follow_up_on = rec.follow_up_on || addDays(on, 7);
    }
  };
  const lastActivity = r => [...(r.events || []).map(e => e.on), r.applied_on, r.created_on].filter(Boolean).sort().pop() || null;
  const sinceDays = d => (d ? between(d, today()) : null);
  function needsAttention(r) {
    if (!OPEN.has(r.status)) return null;
    if (r.follow_up_on && sinceDays(r.follow_up_on) >= 0) {
      const o = sinceDays(r.follow_up_on);
      return `follow-up due${o === 0 ? '' : ` (${o}d overdue)`}`;
    }
    if (r.status === 'draft') {
      const past = sinceDays((r.position || {}).deadline);
      if (past === null) return 'draft - not sent yet';
      return past > 0 ? 'draft - posting closed' : past === 0 ? 'draft - posting closes today' : `draft - posting closes in ${-past}d`;
    }
    const idle = sinceDays(lastActivity(r));
    return idle !== null && idle >= 10 ? `no movement in ${idle}d` : null;
  }
  function dashboard() {
    const recs = list(), by = Object.fromEntries(STATUSES.map(s => [s, 0]));
    const attention = [];
    for (const r of recs) {
      by[r.status] = (by[r.status] || 0) + 1;
      const why = needsAttention(r);
      if (why) attention.push({ slug: r.slug, why, title: r.position?.title, company: r.position?.company, idle_days: sinceDays(lastActivity(r)) });
    }
    attention.sort((a, b) => (b.idle_days || 0) - (a.idle_days || 0));
    return { total: recs.length, by_status: by, open: [...OPEN].reduce((n, s) => n + by[s], 0), attention };
  }
  const list = () => Object.values(state.apps).sort((a, b) => a.slug.localeCompare(b.slug));
  function resumesView() {
    const versions = data.resumes.versions.map(v => {
      const apps = list().filter(a => a.resume_sha === v.sha).map(a => ({ slug: a.slug, title: a.position?.title, company: a.position?.company, status: a.status, applied_on: a.applied_on }));
      const reach = Math.max(-1, ...list().filter(a => a.resume_sha === v.sha).map(a =>
        Math.max(...[a.status, ...a.events.filter(e => e.type === 'status').map(e => e.to)].map(s => PIPELINE.indexOf(s)))));
      return { ...v, apps, label: state.labels[v.sha] || v.label, is_base: v.sha === state.base, best: apps.length ? PIPELINE[Math.max(0, reach)] : null };
    });
    versions.sort((a, b) => (b.is_base - a.is_base) || String(b.first_used || '').localeCompare(String(a.first_used || '')));
    return { base: state.base, versions };
  }
  const find = (text, term) => {
    const words = term.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return words.length ? new RegExp(words.join('\\s+'), 'i').exec(text || '') : null;
  };
  function search(term) {
    const hits = [];
    for (const r of list()) {
      const hay = { position: JSON.stringify(r.position || {}), resume: r.resume_text || '', jd: r.jd || '' };
      const where = Object.keys(hay).filter(k => find(hay[k], term));
      if (!where.length) continue;
      let snippet = '';
      for (const k of ['resume', 'jd']) if (where.includes(k)) { const i = find(hay[k], term).index; snippet = hay[k].slice(Math.max(0, i - 60), i + 120).replace(/\n/g, ' '); break; }
      hits.push({ slug: r.slug, where, snippet, title: r.position?.title, company: r.position?.company });
    }
    return hits;
  }
  const slugify = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 24).replace(/-$/, '');
  const normUrl = u => String(u || '').split('?')[0].replace(/\/$/, '').toLowerCase();

  /* ---------- routing ---------- */
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const notInDemo = () => json({ error: say('This needs the real app on your computer — clone it from GitHub (link in the banner above).',
    'Tính năng này cần bản chạy trên máy bạn — hãy clone từ GitHub (link ở thanh trên cùng).') }, 400);

  async function api(path, opts = {}) {
    await ready;
    const u = new URL(path, location.origin), p = u.pathname, method = (opts.method || 'GET').toUpperCase();
    const body = () => { try { return JSON.parse(opts.body || '{}'); } catch { return {}; } };
    const m = p.match(/^\/api\/application\/([^/]+)(?:\/(\w+))?$/);
    const slug = m && decodeURIComponent(m[1]), rec = slug && state.apps[slug];
    if (method === 'GET') {
      if (p === '/api/applications') return json(list());
      if (p === '/api/dashboard') return json(dashboard());
      if (p === '/api/statuses') return json(data.statuses);
      if (p === '/api/resumes') return json(resumesView());
      if (p === '/api/search') return json(search(u.searchParams.get('q') || ''));
      if (p === '/api/diff') return json(data.diffs[`${u.searchParams.get('a')}|${u.searchParams.get('b')}`] || { rows: [], added: 0, removed: 0, changed: 0 });
      if (p === '/api/state') return json({});
      if (m && !rec) return json({ error: 'unknown application' }, 404);
      if (m && m[2] === 'tailor') return json(data.tailor[slug] || { result: null, ready: { base: !!state.base, jd: !!rec.jd }, command: `/tailor ${slug}` });
      if (m) return json({ ...rec, base_sha: state.base });
      return json({ error: 'not found' }, 404);
    }
    const b = body(), now = today();
    if (p === '/api/state') return json({ ok: true });
    if (p === '/api/import') {
      const want = normUrl(b.url);
      const hit = data.postings.find(x => normUrl(x.url) === want || (x.position.source_id && want.includes(String(x.position.source_id))));
      if (!hit) return json({ error: say('In this demo, Import works with the sample job links (menu in the banner above). The real app imports any VietnamWorks, TopCV, CareerLink, CareerViet, Vieclam24h or Glints job.',
        'Trong bản demo, chức năng Nhập dùng được với các link mẫu (menu ở thanh trên cùng). Bản thật nhập được mọi tin từ VietnamWorks, TopCV, CareerLink, CareerViet, Vieclam24h, Glints.') }, 400);
      const pos = hit.position;
      return json({ position: pos, jd: hit.jd, note: null,
        existing: list().filter(a => a.position?.source === pos.source && a.position?.source_id === pos.source_id).map(a => a.slug) });
    }
    if (p === '/api/application') {
      const pos = b.position || {};
      if (!pos.title || !pos.company) return json({ error: 'a title and a company are required' }, 400);
      let s = [now.slice(0, 7), slugify(pos.company), slugify(pos.title)].filter(Boolean).join('-'), n = 2;
      while (state.apps[s]) s = s.replace(/-\d+$/, '') + `-${n++}`;
      const r = { slug: s, status: 'draft', created_on: now, applied_on: null, follow_up_on: null, position: pos, resume: null,
        events: [{ on: now, type: 'created' }], contacts: [], notes: '', pdfs: [], has_text: false, has_jd: !!b.jd,
        resume_text: '', jd: b.jd || '', resume_sha: null };
      if (b.status && b.status !== 'draft') setStatus(r, b.status, now);
      state.apps[s] = r; save();
      return json({ ok: true, slug: s });
    }
    if (p === '/api/resumes/upload') return notInDemo();
    const rm = p.match(/^\/api\/resumes\/([0-9a-f]{12})$/);
    if (rm) {
      if (typeof b.label === 'string') state.labels[rm[1]] = b.label.trim();
      if (b.base === true) state.base = rm[1];
      if (b.base === false && state.base === rm[1]) state.base = null;
      save(); return json({ ok: true });
    }
    if (m && !rec) return json({ error: 'unknown application' }, 404);
    if (m) {
      const action = m[2];
      if (action === 'upload') return notInDemo();
      if (action === 'delete') { delete state.apps[slug]; save(); return json({ ok: true, trash: 'applications/_trash/' + slug }); }
      if (action === 'status') {
        if (!STATUSES.includes(b.status)) return json({ error: 'bad status' }, 400);
        setStatus(rec, b.status, now);
      } else if (action === 'event') {
        if (!String(b.text || '').trim()) return json({ error: 'an event needs text' }, 400);
        rec.events.push({ on: b.on || now, type: b.type || 'note', text: String(b.text).trim() });
      } else if (action === 'jd') { rec.jd = b.jd || ''; rec.has_jd = !!rec.jd; }
      else if (action === 'fields') {
        for (const k of ['follow_up_on', 'applied_on', 'notes', 'status']) if (k in b) rec[k] = b[k];
        if (b.position && typeof b.position === 'object') Object.assign(rec.position, b.position);
      } else return json({ error: 'unknown action' }, 404);
      save();
      return json({ ok: true, application: rec });
    }
    return json({ error: 'not found' }, 404);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, opts) => {
    const url = typeof input === 'string' ? input : input.url;
    return new URL(url, location.origin).pathname.startsWith('/api/') ? api(url, opts) : realFetch(input, opts);
  };

  /* ---------- the banner: what this is, sample links, reset, GitHub ---------- */
  function banner() {
    let bar = document.getElementById('demo-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-bar';
      document.body.prepend(bar);
      const st = document.createElement('style');
      st.textContent = `#demo-bar{position:relative;z-index:30;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:9px 30px;
        font:12.5px/1.4 var(--body);color:#e7edf5;background:linear-gradient(90deg,#3b2a6b,#14324f);border-bottom:1px solid #2c3b52}
        #demo-bar b{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#c4b5fd}
        #demo-bar .sp{flex:1} #demo-bar a,#demo-bar button{font:inherit;color:#e7edf5;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);
        border-radius:8px;padding:4px 10px;cursor:pointer;text-decoration:none} #demo-bar a.gh{background:#e7edf5;color:#0a0e14;font-weight:600}
        #demo-bar details{position:relative} #demo-bar summary{list-style:none;cursor:pointer;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px 10px;background:rgba(255,255,255,.08)}
        #demo-bar summary::-webkit-details-marker{display:none} #demo-bar .menu{position:absolute;right:0;top:calc(100% + 6px);min-width:340px;max-width:90vw;
        background:#141a24;border:1px solid #242d3d;border-radius:10px;padding:6px;box-shadow:0 16px 40px -12px #000}
        #demo-bar .menu a{display:block;border:0;background:none;padding:8px 10px;border-radius:7px} #demo-bar .menu a:hover{background:#1a212e}
        #demo-bar .menu small{display:block;color:#8b97a8} @media(max-width:640px){#demo-bar{padding:9px 16px}}`;
      document.head.append(st);
    }
    bar.textContent = '';
    const el = (tag, attrs = {}, text = '') => { const n = document.createElement(tag); Object.assign(n, attrs); if (text) n.textContent = text; return n; };
    bar.append(el('b', {}, say('Live demo', 'Bản demo')),
      el('span', {}, say('Sample data — statuses and notes are fictional. Your changes stay in this browser.',
                         'Dữ liệu mẫu — trạng thái và ghi chú là giả định. Thay đổi của bạn chỉ lưu trên trình duyệt này.')),
      el('span', { className: 'sp' }));
    const samples = el('details');
    samples.append(el('summary', {}, say('Try importing a job ▾', 'Thử nhập một tin ▾')));
    const menu = el('div', { className: 'menu' });
    for (const p of (data?.postings || [])) {
      const a = el('a', { href: '/new?url=' + encodeURIComponent(p.url) });
      a.append(el('span', {}, p.position.title), el('small', {}, `${p.position.company} · ${p.position.source}`));
      menu.append(a);
    }
    samples.append(menu);
    const reset = el('button', {}, say('Reset demo', 'Đặt lại demo'));
    reset.onclick = () => { try { localStorage.removeItem(KEY); } catch { /* nothing saved */ } location.href = '/'; };
    bar.append(samples, reset,
      el('a', { className: 'gh', href: data?.github || 'https://github.com', target: '_blank', rel: 'noopener' }, say('Get it on GitHub →', 'Lấy mã trên GitHub →')));
  }
  addEventListener('DOMContentLoaded', () => ready.then(() => {
    banner();
    if (typeof window.setLang === 'function') {            // re-label the banner when the flag is clicked
      const orig = window.setLang;
      window.setLang = l => { orig(l); banner(); };
    }
  }));
})();
