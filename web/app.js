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
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const money = s => {
  if (!s) return '—';
  if (s.negotiable) return 'Negotiable';
  const f = n => s.currency === 'VND' ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M ₫' : '$' + n.toLocaleString();
  if (s.min && s.max) return `${f(s.min)} – ${f(s.max)}`;
  if (s.min) return (s.open_ended ? 'from ' : '') + f(s.min);
  return s.raw || '—';
};
const ago = d => {
  if (!d) return '—';
  const n = Math.round((Date.now() - new Date(d + 'T00:00:00')) / 864e5);
  return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`;
};
const statusPill = s => el('span', { class: `pill s-${s || 'draft'}` }, s || 'draft');

/* ---------------- routing ---------------- */
const views = {};
const register = (key, label, render) => { views[key] = { label, render }; };

function nav() {
  const n = $('#nav'); n.textContent = '';
  for (const [k, v] of Object.entries(views)) {
    n.append(el('button', { class: current === k ? 'on' : '', onclick: () => go(k) }, v.label));
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
  const view = views[current] || { render: detailView };
  const sec = el('section', { class: 'on' });
  main.append(sec);
  try { await (current === 'detail' ? detailView : view.render)(sec, param); }
  catch (e) { sec.append(el('div', { class: 'err' }, e.message)); }
}

/* ---------------- Home ---------------- */
register('home', 'Home', async sec => {
  const d = await api('/api/dashboard');
  $('#hdr').textContent = `${d.open} open · ${d.total} total`;

  sec.append(el('div', { class: 'grid' }, Object.entries(d.by_status)
    .filter(([, n]) => n)
    .map(([s, n]) => el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [statusPill(s), el('div', { class: 'sp' }), el('strong', {}, String(n))])
    ]))));

  sec.append(el('h3', {}, 'Needs attention'));
  if (!d.attention.length) {
    sec.append(el('div', { class: 'card muted' }, 'Nothing waiting on you. Every open application has moved recently.'));
  } else {
    for (const a of d.attention) {
      sec.append(el('div', { class: 'card click', onclick: () => go('detail', a.slug) }, [
        el('div', { class: 'row' }, [
          el('div', {}, [el('div', {}, a.title || a.slug),
                         el('div', { class: 'muted sm' }, a.company || '')]),
          el('div', { class: 'sp' }),
          el('span', { class: 'pill', style: 'color:var(--amber);border-color:#6b4d1f' }, a.why)
        ])
      ]));
    }
  }
});

/* ---------------- Applications ---------------- */
register('applications', 'Applications', async sec => {
  const apps = await api('/api/applications');
  $('#hdr').textContent = `${apps.length} application${apps.length === 1 ? '' : 's'}`;

  const search = el('input', { placeholder: 'Search resumes, job descriptions, positions…' });
  const results = el('div');
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      results.textContent = '';
      const q = search.value.trim();
      if (!q) return;
      const hits = await api('/api/search?q=' + encodeURIComponent(q));
      results.append(el('div', { class: 'muted sm' }, `${hits.length} match${hits.length === 1 ? '' : 'es'}`));
      for (const h of hits) {
        results.append(el('div', { class: 'card click', onclick: () => go('detail', h.slug) }, [
          el('div', {}, `${h.title || h.slug} — ${h.company || ''}`),
          el('div', { class: 'muted sm' }, 'in: ' + h.where.join(', ')),
          h.snippet ? el('div', { class: 'sm', style: 'margin-top:6px;opacity:.85' }, '…' + h.snippet + '…') : ''
        ]));
      }
    }, 220);
  });
  sec.append(el('div', { class: 'card' }, [search]), results);

  if (!apps.length) {
    sec.append(el('div', { class: 'card muted' }, 'No applications yet. Use the New tab to add one.'));
    return;
  }
  const rows = apps.map(a => el('tr', { class: 'click', onclick: () => go('detail', a.slug) }, [
    el('td', {}, [el('div', {}, (a.position || {}).title || a.slug),
                  el('div', { class: 'muted sm' }, (a.position || {}).company || '')]),
    el('td', {}, [statusPill(a.status)]),
    el('td', { class: 'sm muted' }, (a.position || {}).location || '—'),
    el('td', { class: 'sm muted' }, money((a.position || {}).salary)),
    el('td', { class: 'sm muted' }, ago(a.applied_on || a.created_on)),
    el('td', { class: 'sm muted' }, a.resume ? '📄' : '—')
  ]));
  sec.append(el('table', {}, [
    el('thead', {}, [el('tr', {}, ['Position', 'Status', 'Location', 'Salary', 'Applied', 'CV'].map(h => el('th', {}, h)))]),
    el('tbody', {}, rows)
  ]));
});

/* ---------------- New ---------------- */
register('new', 'New', async sec => {
  $('#hdr').textContent = '';
  const url = el('input', { placeholder: 'Paste a VietnamWorks job URL, then press Import' });
  const msg = el('div');
  const f = {};
  const field = (k, label, ph) => {
    f[k] = el('input', { placeholder: ph || '' });
    return el('div', {}, [el('label', {}, label), f[k]]);
  };
  const form = el('div', { class: 'card' }, [
    field('title', 'Job title *'), field('company', 'Company *'),
    field('location', 'Location'), field('salary_raw', 'Salary'),
    el('label', {}, 'Job description (paste it — see note)'),
    f.jd = el('textarea', { placeholder: 'Paste the responsibilities / requirements here.' }),
  ]);
  let imported = null;

  sec.append(el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [url, el('button', {
      class: 'btn', onclick: async () => {
        msg.textContent = ''; msg.className = '';
        if (!url.value.trim()) return;
        try {
          const d = await api('/api/import', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.value.trim() })
          });
          imported = d.position;
          f.title.value = d.position.title || '';
          f.company.value = d.position.company || '';
          f.location.value = d.position.location || '';
          f.salary_raw.value = (d.position.salary || {}).raw || '';
          msg.className = 'warn'; msg.textContent = d.note;
        } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
      }
    }, 'Import')])
  ]), msg, form);

  sec.append(el('button', {
    class: 'btn pri', onclick: async () => {
      const position = Object.assign({}, imported || {}, {
        title: f.title.value.trim(), company: f.company.value.trim(),
        location: f.location.value.trim() || null
      });
      if (!position.title || !position.company) {
        msg.className = 'err'; msg.textContent = 'A title and a company are required.'; return;
      }
      try {
        const d = await api('/api/application', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position, jd: f.jd.value, status: 'draft' })
        });
        go('detail', d.slug);
      } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
    }
  }, 'Create application'));
});

/* ---------------- Detail ---------------- */
async function detailView(sec, slug) {
  const a = await api('/api/application/' + encodeURIComponent(slug));
  const pos = a.position || {};
  $('#hdr').textContent = a.slug;
  const reload = () => go('detail', slug, false);

  const statuses = ['draft', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'];
  const sel = el('select', {
    onchange: async () => {
      await api(`/api/application/${slug}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: sel.value })
      });
      reload();
    }
  }, statuses.map(s => el('option', { value: s, selected: s === a.status ? '' : null }, s)));

  const fu = el('input', { type: 'date', value: a.follow_up_on || '' });
  fu.addEventListener('change', async () => {
    await api(`/api/application/${slug}/fields`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ follow_up_on: fu.value || null })
    });
    reload();
  });

  sec.append(el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [el('h2', { style: 'margin:0 0 2px;font-size:18px' }, pos.title || slug),
                     el('div', { class: 'muted' }, pos.company || '')]),
      el('div', { class: 'sp' }), statusPill(a.status)
    ]),
    el('div', { class: 'sep' }),
    el('div', { class: 'grid' }, [
      el('div', {}, [el('label', {}, 'Status'), sel]),
      el('div', {}, [el('label', {}, 'Follow up on'), fu]),
      el('div', {}, [el('label', {}, 'Location'), el('div', {}, pos.location || '—')]),
      el('div', {}, [el('label', {}, 'Salary'), el('div', {}, money(pos.salary))]),
      el('div', {}, [el('label', {}, 'Applied'), el('div', {}, a.applied_on || '—')]),
      el('div', {}, [el('label', {}, 'Source'),
                     el('div', {}, pos.url ? [el('a', { href: pos.url, target: '_blank', rel: 'noopener noreferrer' }, pos.source || 'link')] : ['—'])])
    ])
  ]));

  /* --- resume --- */
  const up = el('input', { type: 'file', accept: 'application/pdf' });
  const upMsg = el('div');
  up.addEventListener('change', async () => {
    const file = up.files[0]; if (!file) return;
    upMsg.className = 'muted sm'; upMsg.textContent = 'uploading…';
    try {
      const d = await api(`/api/application/${slug}/upload?name=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: await file.arrayBuffer() });
      upMsg.className = d.warning ? 'warn' : 'muted sm';
      upMsg.textContent = d.warning || `extracted ${d.extracted_chars} characters from ${d.pages} page(s)`;
      setTimeout(reload, 900);
    } catch (e) { upMsg.className = 'err'; upMsg.textContent = e.message; }
  });

  const left = el('div', {}, [
    el('div', { class: 'card' }, [
      el('label', {}, 'Resume sent'),
      a.resume ? el('div', {}, [
        el('div', { class: 'row' }, [
          el('strong', {}, a.resume.file), el('div', { class: 'sp' }),
          el('a', { href: `/applications/${slug}/${encodeURIComponent(a.resume.file)}`, target: '_blank' }, 'open')
        ]),
        a.resume.text_ok === false
          ? el('div', { class: 'warn', style: 'margin-top:8px' },
              'No text layer found — search and tailoring will not work on this PDF.')
          : el('div', { class: 'muted sm', style: 'margin-top:4px' },
              `${a.resume.pages} page(s) · text extracted`)
      ]) : el('div', { class: 'muted sm' }, 'No resume attached yet.'),
      el('div', { style: 'margin-top:10px' }, [up]), upMsg
    ]),
    a.resume ? el('iframe', { class: 'pdf', src: `/applications/${slug}/${encodeURIComponent(a.resume.file)}#view=FitH` }) : ''
  ]);

  /* --- events + jd --- */
  const evText = el('input', { placeholder: 'e.g. recruiter replied, phone screen booked' });
  const addEv = async () => {
    if (!evText.value.trim()) return;
    await api(`/api/application/${slug}/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: evText.value.trim() })
    });
    reload();
  };
  evText.addEventListener('keydown', e => { if (e.key === 'Enter') addEv(); });

  const jd = el('textarea', { placeholder: 'Paste the job description here.' });
  jd.value = a.jd || '';

  const right = el('div', {}, [
    el('div', { class: 'card' }, [
      el('label', {}, 'Timeline'),
      ...(a.events || []).slice().reverse().map(e => el('div', { class: 'ev' }, [
        el('div', { class: 'sm' }, e.text || (e.type === 'status' ? `${e.from || '—'} → ${e.to}` : e.type)),
        el('div', { class: 'muted sm' }, `${e.on} · ${ago(e.on)}`)
      ])),
      el('div', { class: 'row', style: 'margin-top:10px' }, [evText, el('button', { class: 'btn', onclick: addEv }, 'Log')])
    ]),
    el('div', { class: 'card' }, [
      el('label', {}, 'Job description'), jd,
      el('button', {
        class: 'btn', style: 'margin-top:8px', onclick: async () => {
          await api(`/api/application/${slug}/jd`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jd: jd.value })
          });
          reload();
        }
      }, 'Save JD')
    ])
  ]);

  sec.append(el('div', { class: 'two' }, [left, right]));
}

/* ---------------- boot ---------------- */
(function boot() {
  const r = route(); current = r.key; param = r.p;
  nav(); render();
})();
