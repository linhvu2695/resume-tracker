/* Resume tracker frontend. One page, no framework, no build step.
   Views register into a tab bar and render into #main; routing is path-based
   (/ , /applications , /new , /a/<slug>) so every application deep-links. */
'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.append(c?.nodeType ? c : document.createTextNode(c ?? ''));
  return n;
};
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({ error: 'bad response' }));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUSES = ['draft', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'];
const PIPELINE = ['draft', 'applied', 'screening', 'interview', 'offer'];    // the forward path
const CLOSED = ['rejected', 'withdrawn'];

const money = s => {
  if (!s) return '—';
  if (s.negotiable) return 'Negotiable';
  const f = n => s.currency === 'VND' ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M ₫' : '$' + n.toLocaleString();
  if (s.min && s.max) return `${f(s.min)} – ${f(s.max)}`;
  if (s.min) return (s.open_ended ? 'from ' : '') + f(s.min);
  return s.raw || '—';
};
const daysFrom = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5) : null;
const ago = d => {
  const n = daysFrom(d);
  if (n === null) return '—';
  return n === 0 ? 'today' : n === -1 ? 'yesterday' : n < 0 ? `${-n}d ago` : `in ${n}d`;
};
/* How urgent a deadline is, for coloring: closed / within 3 days / later. */
const deadlineInfo = d => {
  const n = daysFrom(d);
  if (n === null) return null;
  if (n < 0) return { cls: 'u-bad', text: 'posting closed' };
  if (n === 0) return { cls: 'u-bad', text: 'closes today' };
  return { cls: n <= 3 ? 'u-warn' : 'u-info', text: `closes in ${n}d` };
};
const pill = (text, cls) => el('span', { class: `pill ${cls}` }, [el('i'), text]);
const statusPill = s => pill(s || 'draft', `st-${s || 'draft'}`);
const lbl = t => el('span', { class: 'lbl' }, t);
const b = t => el('b', {}, String(t));

/* Minimal renderer for the imported JD: "## " headings, "-"/"•" bullets, plain lines. */
function jdView(md) {
  const box = el('div', { class: 'jd' });
  let ul = null;
  for (const raw of (md || '').split('\n')) {
    const line = raw.trim();
    if (!line) { ul = null; continue; }
    if (line.startsWith('## ')) { ul = null; box.append(el('h4', {}, line.slice(3))); continue; }
    const m = line.match(/^[-•*]\s*(.*)$/);
    if (m) { if (!ul) box.append(ul = el('ul')); ul.append(el('li', {}, m[1])); continue; }
    if (raw.startsWith('  ') && ul?.lastChild) { ul.lastChild.append(el('br'), line); continue; }
    // Short ALL-CAPS lines are section titles inside the employer's own text ("QUYỀN LỢI").
    if (line.length < 40 && line === line.toUpperCase() && /\p{L}/u.test(line)) { ul = null; box.append(el('h5', {}, line)); continue; }
    ul = null; box.append(el('p', {}, line));
  }
  return box;
}

/* A styled PDF picker that also accepts drag-and-drop. onFile(file) fires on pick. */
function dropzone(text, onFile) {
  const input = el('input', { type: 'file', accept: 'application/pdf' });
  const name = el('div', { class: 'muted sm' }, 'Click to choose, or drop a PDF here');
  const zone = el('label', { class: 'drop' }, [
    el('span', { class: 'ico' }, '📄'), el('div', {}, [el('div', {}, text), name]), input
  ]);
  const take = f => {
    if (!f) return;
    zone.classList.add('has'); name.textContent = `${f.name} · ${Math.round(f.size / 1024)} KB`;
    zone.file = f; onFile && onFile(f);
  };
  input.addEventListener('change', () => take(input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    take([...e.dataTransfer.files].find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
  });
  return zone;
}
const uploadPdf = (slug, file) => file.arrayBuffer().then(buf =>
  api(`/api/application/${slug}/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: buf }));

/* ---------------- routing ---------------- */
const views = {};
const register = (key, label, render) => { views[key] = { label, render }; };

function nav() {
  const n = $('#nav'); n.textContent = '';
  for (const [k, v] of Object.entries(views)) {
    n.append(el('button', { class: (current === k ? 'on' : '') + (k === 'new' ? ' add' : ''), onclick: () => go(k) }, v.label));
  }
}
let current = 'home', param = null;

function pathFor(k, p) { return k === 'home' ? '/' : p ? `/a/${p}` : `/${k}`; }
function go(key, p, push = true) {
  current = key; param = p || null;
  if (push) history.pushState({ key, p }, '', pathFor(key, p));
  nav(); render();
}
function route() {
  const m = location.pathname.match(/^\/a\/(.+)$/);
  if (m) return { key: 'detail', p: decodeURIComponent(m[1]) };
  const k = location.pathname.replace(/^\//, '') || 'home';
  return { key: views[k] || k === 'detail' ? k : 'home', p: null };
}
addEventListener('popstate', () => { const r = route(); current = r.key; param = r.p; nav(); render(); });

async function render() {
  const main = $('#main'); main.textContent = '';
  $('#hdr').textContent = '';
  const view = views[current] || { render: detailView };
  const sec = el('section');
  main.append(sec);
  try { await (current === 'detail' ? detailView : view.render)(sec, param); }
  catch (e) { sec.append(el('div', { class: 'note err' }, e.message)); }
}
const hud = (...parts) => { const h = $('#hdr'); h.textContent = ''; h.append(...parts); };

/* ---------------- Home ---------------- */
let listFilter = null;      // a status picked on Home carries over to Applications

register('home', 'Home', async sec => {
  const d = await api('/api/dashboard');
  hud(b(d.open), ' open · ', b(d.total), ' total');

  sec.append(el('div', { class: 'h', style: 'margin-top:0' }, 'Pipeline'));
  sec.append(el('div', { class: 'pipe' }, STATUSES.map((s, i) => el('button', {
    class: `tile rise st-${s}${d.by_status[s] ? '' : ' zero'}`, style: `--i:${i}`,
    onclick: () => { listFilter = s; go('applications'); }
  }, [el('div', { class: 'n' }, String(d.by_status[s] || 0)), el('div', { class: 'l' }, s)]))));

  sec.append(el('div', { class: 'h' }, 'Needs attention'));
  if (!d.total) {
    sec.append(el('div', { class: 'card empty' }, [
      el('div', { class: 'big' }, 'No applications yet'),
      el('div', {}, 'Save a VietnamWorks job and it will show up here.'),
      el('div', { style: 'margin-top:16px' }, [el('button', { class: 'btn pri big', onclick: () => go('new') }, '＋ Save your first job')])
    ]));
    return;
  }
  if (!d.attention.length) {
    sec.append(el('div', { class: 'card glow empty st-offer' }, [
      el('div', { class: 'big' }, 'Nothing waiting on you'),
      el('div', {}, 'Every open application has moved recently.')
    ]));
    return;
  }
  d.attention.forEach((a, i) => {
    const urgent = /closed|today|overdue|due/.test(a.why) ? 'u-bad' : /closes in [1-3]d/.test(a.why) ? 'u-warn' : 'u-info';
    sec.append(el('div', { class: `card bar click rise ${urgent}`, style: `--i:${i + 7}`, onclick: () => go('detail', a.slug) }, [
      el('div', { class: 'row' }, [
        el('div', { style: 'min-width:0' }, [
          el('div', { style: 'font-weight:600;font-size:15px' }, a.title || a.slug),
          el('div', { class: 'muted sm' }, a.company || '')
        ]),
        el('div', { class: 'sp' }),
        pill(a.why, urgent)
      ])
    ]));
  });
});

/* ---------------- Applications ---------------- */
register('applications', 'Applications', async sec => {
  const apps = await api('/api/applications');
  hud(b(apps.length), ` application${apps.length === 1 ? '' : 's'}`);

  const search = el('input', { class: 'hero', placeholder: 'Search resumes, job descriptions, companies…' });
  const results = el('div');
  const list = el('div');
  const filters = el('div', { class: 'filters' });
  const count = s => apps.filter(a => !s || a.status === s).length;

  const drawFilters = () => {
    filters.textContent = '';
    for (const s of [null, ...STATUSES]) {
      if (s && !count(s)) continue;
      filters.append(el('button', {
        class: `${s ? 'st-' + s : ''}${listFilter === s ? ' on' : ''}`,
        onclick: () => { listFilter = s; drawFilters(); drawList(); }
      }, [s ? el('i') : '', s || 'all', el('span', {}, String(count(s)))]));
    }
  };
  const drawList = () => {
    list.textContent = '';
    if (!apps.length) {
      list.append(el('div', { class: 'card empty' }, [
        el('div', { class: 'big' }, 'No applications yet'),
        el('div', { style: 'margin-top:14px' }, [el('button', { class: 'btn pri big', onclick: () => go('new') }, '＋ Save a job')])
      ]));
      return;
    }
    const shown = apps.filter(a => !listFilter || a.status === listFilter);
    shown.forEach((a, i) => {
      const p = a.position || {};
      const dl = a.status === 'draft' ? deadlineInfo(p.deadline) : null;
      list.append(el('div', { class: `card bar click rise st-${a.status}`, style: `--i:${i}`, onclick: () => go('detail', a.slug) }, [
        el('div', { class: 'app' }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 't' }, p.title || a.slug),
            el('div', { class: 's' }, (p.company || '') + (p.location ? ` · ${p.location}` : ''))
          ]),
          el('div', {}, [statusPill(a.status)]),
          el('div', { class: 'm' }, [el('b', {}, 'Salary'), money(p.salary)]),
          el('div', { class: 'm' }, [el('b', {}, 'Applied'), a.applied_on ? ago(a.applied_on) : el('span', { class: 'faint' }, 'not sent')]),
          el('div', { class: 'm' }, dl ? [el('b', {}, 'Deadline'), el('span', { class: dl.cls, style: 'color:var(--c)' }, dl.text)]
                                       : [el('b', {}, 'Follow-up'), a.follow_up_on ? ago(a.follow_up_on) : '—']),
          el('div', { class: 'cv', title: a.resume ? a.resume.file : 'no resume attached' }, a.resume ? '📄' : el('span', { class: 'faint' }, '·'))
        ])
      ]));
    });
    if (!shown.length) list.append(el('div', { class: 'card empty' }, `No ${listFilter} applications.`));
  };

  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      results.textContent = '';
      const q = search.value.trim();
      list.style.display = filters.style.display = q ? 'none' : '';
      if (!q) return;
      const hits = await api('/api/search?q=' + encodeURIComponent(q));
      results.append(el('div', { class: 'h' }, `${hits.length} match${hits.length === 1 ? '' : 'es'}`));
      const rx = new RegExp(q.split(/\s+/).map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'ig');
      hits.forEach((h, i) => {
        results.append(el('div', { class: 'card bar click rise u-warn', style: `--i:${i}`, onclick: () => go('detail', h.slug) }, [
          el('div', { class: 'row' }, [
            el('div', {}, [el('div', { style: 'font-weight:600' }, h.title || h.slug), el('div', { class: 'muted sm' }, h.company || '')]),
            el('div', { class: 'sp' }),
            ...h.where.map(w => pill(w === 'jd' ? 'job description' : w, 'u-info'))
          ]),
          h.snippet ? el('div', { class: 'hit', html: '…' + esc(h.snippet).replace(rx, m => `<mark>${m}</mark>`) + '…' }) : ''
        ]));
      });
    }, 220);
  });

  sec.append(search, filters, results, list);
  drawFilters(); drawList();
});

/* ---------------- New ----------------
   Normal path: on a VietnamWorks job page, click the "Save to tracker" bookmark. It opens
   /new?url=<that page>; the import runs by itself and fills everything, JD included.
   Nothing is created until Save is clicked, so no other site can write records here. */
register('new', '＋ New', async sec => {
  hud('save a job');
  const url = el('input', { class: 'hero', placeholder: 'Paste a VietnamWorks job link…' });
  const importBtn = el('button', { class: 'btn blue big' }, 'Import');
  const msg = el('div');
  const f = {};
  const field = (k, label) => el('div', {}, [lbl(label), f[k] = el('input')]);
  const pdf = dropzone('Resume to send');
  f.applied = el('input', { type: 'checkbox' });
  f.jd = el('textarea', { placeholder: 'Paste the job description if the import could not read it.' });
  let imported = null;

  const jdBox = el('div', { style: 'margin-top:12px' });
  const showJd = () => {
    jdBox.textContent = '';
    if (!f.jd.value.trim()) { jdBox.append(f.jd); return; }
    jdBox.append(jdView(f.jd.value), el('button', {
      class: 'linkbtn sm', style: 'margin-top:10px', onclick: () => { jdBox.textContent = ''; jdBox.append(f.jd); f.jd.focus(); }
    }, 'edit'));
  };
  const facts = el('div', { class: 'facts' });
  f.save = el('button', { class: 'btn pri big' }, 'Save application');
  const form = el('div', { style: 'display:none' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow st-applied' }, 'Position'),
      facts,
      el('div', { style: 'margin-top:16px' }, [field('title', 'Job title *')]),
      el('div', { class: 'grid2', style: 'margin-top:14px' }, [field('company', 'Company *'), field('location', 'Location')])
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'eyebrow st-interview' }, 'Resume'), el('div', { style: 'margin-top:12px' }, [pdf])]),
    el('div', { class: 'card' }, [el('div', { class: 'eyebrow', style: '--c:var(--pink)' }, 'Job description'), jdBox]),
    el('div', { class: 'row wrap', style: 'margin-top:6px' }, [
      el('label', { class: 'check' }, [f.applied, 'I have already applied']),
      el('div', { class: 'sp' }),
      f.save
    ])
  ]);
  const reveal = () => { form.style.display = ''; showJd(); };

  const doImport = async () => {
    msg.textContent = ''; msg.className = '';
    if (!url.value.trim()) return;
    importBtn.disabled = true; importBtn.textContent = 'Importing…';
    try {
      const d = await post('/api/import', { url: url.value.trim() });
      const p = imported = d.position;
      f.title.value = p.title || ''; f.company.value = p.company || '';
      f.location.value = p.location || '';
      if (d.jd) f.jd.value = d.jd;
      facts.textContent = '';
      const dl = deadlineInfo(p.deadline);
      if (p.salary) facts.append(el('span', { class: 'chip' }, ['💰 ', b(money(p.salary))]));
      if (p.location) facts.append(el('span', { class: 'chip' }, ['📍 ', p.location]));
      if (dl) facts.append(pill(`${dl.text} · ${p.deadline}`, dl.cls));
      if (d.existing?.length) {
        msg.className = 'note warn';
        msg.append('You already track this posting. ',
          el('button', { class: 'linkbtn', onclick: () => go('detail', d.existing[0]) }, 'Open it'),
          ' — or save again to create a second record.');
      } else if (d.note) {
        msg.className = 'note warn'; msg.textContent = d.note;
      } else {
        msg.className = 'note ok'; msg.textContent = 'Imported. Pick the resume you are sending and save.';
      }
      reveal();
    } catch (e) { msg.className = 'note err'; msg.textContent = e.message; }
    importBtn.disabled = false; importBtn.textContent = 'Import';
  };
  importBtn.addEventListener('click', doImport);
  url.addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });

  f.save.addEventListener('click', async () => {
    const position = Object.assign({}, imported || {}, {
      title: f.title.value.trim(), company: f.company.value.trim(), location: f.location.value.trim() || null
    });
    if (!position.title || !position.company) {
      msg.className = 'note err'; msg.textContent = 'A job title and a company are required.'; window.scrollTo(0, 0); return;
    }
    f.save.disabled = true; f.save.textContent = 'Saving…';
    try {
      const d = await post('/api/application', { position, jd: f.jd.value, status: f.applied.checked ? 'applied' : 'draft' });
      if (pdf.file) {
        try { await uploadPdf(d.slug, pdf.file); }
        catch (e) { alert(`Saved, but the resume upload failed: ${e.message}`); }
      }
      go('detail', d.slug);
    } catch (e) {
      msg.className = 'note err'; msg.textContent = e.message;
      f.save.disabled = false; f.save.textContent = 'Save application';
    }
  });

  const bookmarklet = `javascript:void(window.open('${location.origin}/new?url='+encodeURIComponent(location.href),'_blank'))`;
  sec.append(
    el('div', { class: 'card glow st-offer' }, [
      el('div', { class: 'eyebrow' }, 'One-time setup'),
      el('div', { class: 'row wrap', style: 'margin-top:12px' }, [
        el('div', { style: 'flex:1;min-width:260px' }, [
          el('div', { style: 'font-weight:600' }, 'Drag this button to your bookmarks bar.'),
          el('div', { class: 'muted sm' }, 'Then on any VietnamWorks job page, click it — the job opens here already filled in.')
        ]),
        el('a', { href: bookmarklet, class: 'grab', title: 'Drag me to the bookmarks bar', onclick: e => e.preventDefault() }, '＋ Save to tracker')
      ])
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow st-applied' }, 'Or paste a link'),
      el('div', { class: 'row', style: 'margin-top:12px' }, [url, importBtn]),
      el('div', { class: 'sm faint', style: 'margin-top:10px' }, [
        'Not on VietnamWorks? ', el('button', { class: 'linkbtn', onclick: reveal }, 'Fill it in by hand')
      ])
    ]),
    msg, form
  );

  // Arrived from the bookmark: import straight away, then drop ?url= from the address bar.
  const incoming = new URLSearchParams(location.search).get('url');
  if (incoming) {
    history.replaceState(history.state, '', '/new');
    url.value = incoming;
    await doImport();
  }
});

/* ---------------- Detail ---------------- */
async function detailView(sec, slug) {
  const a = await api('/api/application/' + encodeURIComponent(slug));
  const pos = a.position || {};
  const reload = () => go('detail', slug, false);
  hud(statusPill(a.status), ' ', a.applied_on ? `applied ${ago(a.applied_on)}` : 'not sent yet');

  const setStatus = async s => { if (s !== a.status) { await post(`/api/application/${slug}/status`, { status: s }); reload(); } };
  const at = PIPELINE.indexOf(a.status);
  const stepper = el('div', { class: 'stepper' }, [
    ...PIPELINE.map((s, i) => el('button', {
      class: `st-${s}${s === a.status ? ' on' : at > i ? ' past' : ''}`, onclick: () => setStatus(s)
    }, s)),
    el('span', { class: 'gap' }),
    ...CLOSED.map(s => el('button', { class: `st-${s}${s === a.status ? ' on' : ''}`, onclick: () => setStatus(s) }, s))
  ]);

  const fu = el('input', { type: 'date', value: a.follow_up_on || '', style: 'width:auto;padding:2px 6px;border-radius:6px' });
  fu.addEventListener('change', async () => { await post(`/api/application/${slug}/fields`, { follow_up_on: fu.value || null }); reload(); });

  const dl = deadlineInfo(pos.deadline);
  const facts = el('div', { class: 'facts' }, [
    pos.salary ? el('span', { class: 'chip' }, ['💰 ', b(money(pos.salary))]) : '',
    pos.location ? el('span', { class: 'chip' }, ['📍 ', pos.location]) : '',
    dl && a.status === 'draft' ? pill(`${dl.text} · ${pos.deadline}`, dl.cls) : pos.deadline ? el('span', { class: 'chip' }, ['⏳ closes ', pos.deadline]) : '',
    a.applied_on ? el('span', { class: 'chip' }, ['📨 applied ', b(a.applied_on)]) : '',
    el('span', { class: 'chip' }, ['🔔 follow up ', fu]),
    pos.contact_email ? el('span', { class: 'chip' }, ['✉️ ', el('a', { href: `mailto:${pos.contact_email}` }, pos.contact_email)]) : '',
    pos.url ? el('span', { class: 'chip' }, ['🔗 ', el('a', { href: pos.url, target: '_blank', rel: 'noopener noreferrer' }, pos.source || 'posting')]) : ''
  ]);

  sec.append(el('div', { class: `card glow st-${a.status}` }, [
    el('div', { class: 'eyebrow' }, pos.company || 'application'),
    el('h2', { class: 'title' }, pos.title || slug),
    facts, stepper
  ]));

  /* --- resume --- */
  const upMsg = el('div');
  const zone = dropzone(a.resume ? 'Replace the resume' : 'Attach the resume you sent', async file => {
    upMsg.className = 'muted sm'; upMsg.textContent = 'uploading…';
    try {
      const d = await uploadPdf(slug, file);
      upMsg.className = d.warning ? 'note warn' : 'note ok';
      upMsg.textContent = d.warning || `Extracted ${d.extracted_chars} characters from ${d.pages} page(s).`;
      setTimeout(reload, 900);
    } catch (e) { upMsg.className = 'note err'; upMsg.textContent = e.message; }
  });
  const pdfUrl = a.resume ? `/applications/${slug}/${encodeURIComponent(a.resume.file)}` : null;
  const left = el('div', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('div', { class: 'eyebrow st-interview' }, 'Resume sent'), el('div', { class: 'sp' }),
                                   pdfUrl ? el('a', { class: 'btn', href: pdfUrl, target: '_blank' }, 'open ↗') : '']),
      a.resume ? el('div', { style: 'margin:12px 0' }, [
        el('div', { style: 'font-weight:600' }, a.resume.file),
        a.resume.text_ok === false
          ? el('div', { class: 'note warn' }, 'No text layer found — search will not work on this PDF.')
          : el('div', { class: 'muted sm' }, `${a.resume.pages} page(s) · text extracted, searchable`)
      ]) : el('div', { class: 'muted sm', style: 'margin:10px 0' }, 'No resume attached yet.'),
      zone, upMsg
    ]),
    pdfUrl ? el('iframe', { class: 'pdf', src: pdfUrl + '#view=FitH', title: 'resume preview' }) : ''
  ]);

  /* --- timeline + jd --- */
  const evText = el('input', { placeholder: 'Log something — recruiter replied, call booked…' });
  const addEv = async () => {
    if (!evText.value.trim()) return;
    await post(`/api/application/${slug}/event`, { text: evText.value.trim() });
    reload();
  };
  evText.addEventListener('keydown', e => { if (e.key === 'Enter') addEv(); });
  const evLine = e => {
    if (e.type === 'status') return [`${e.from || '—'} → `, b(e.to)];
    if (e.type === 'resume') return ['resume attached · ', el('span', { class: 'muted' }, e.text)];
    return [e.text || e.type];
  };
  const evColor = e => e.type === 'status' ? `st-${e.to}` : e.type === 'resume' ? 'st-interview' : e.type === 'created' ? 'st-draft' : 'u-warn';

  const jd = el('textarea', { placeholder: 'Paste the job description here.' });
  jd.value = a.jd || '';
  const jdBox = el('div', { style: 'margin-top:12px' });
  const jdEdit = el('button', { class: 'btn' }, 'edit');
  const showJd = editing => {
    jdBox.textContent = '';
    jdEdit.style.display = editing || !a.jd ? 'none' : '';
    if (editing || !a.jd) {
      jdBox.append(jd, el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn pri', onclick: async () => { await post(`/api/application/${slug}/jd`, { jd: jd.value }); reload(); } }, 'Save'),
        a.jd ? el('button', { class: 'btn', onclick: () => showJd(false) }, 'Cancel') : ''
      ]));
    } else jdBox.append(jdView(a.jd));
  };
  jdEdit.addEventListener('click', () => showJd(true));
  showJd(false);

  const right = el('div', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow u-warn' }, 'Timeline'),
      el('div', { class: 'tl', style: 'margin-top:14px' }, (a.events || []).slice().reverse().map(e =>
        el('div', { class: `ev ${evColor(e)}` }, [el('i'), el('div', { class: 'w' }, evLine(e)), el('div', { class: 'd' }, `${e.on} · ${ago(e.on)}`)]))),
      el('div', { class: 'row', style: 'margin-top:4px' }, [evText, el('button', { class: 'btn', onclick: addEv }, 'Log')])
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('div', { class: 'eyebrow', style: '--c:var(--pink)' }, 'Job description'), el('div', { class: 'sp' }), jdEdit]),
      jdBox
    ])
  ]);

  sec.append(el('div', { class: 'two' }, [left, right]));
}

/* ---------------- boot ---------------- */
(function boot() {
  const r = route(); current = r.key; param = r.p;
  nav(); render();
})();
