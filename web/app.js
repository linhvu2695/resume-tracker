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

/* ---------------- language ----------------
   UI text is English in the code and looked up here for Vietnamese; a missing entry falls
   back to English rather than breaking. Data (titles, JDs, notes) is never translated.
   The choice is a per-browser convenience, so localStorage is enough (and may be blocked). */
const VI = {
  // shell
  'Local · Private · Yours': 'Trên máy bạn · Riêng tư', 'Home': 'Tổng quan', 'Applications': 'Hồ sơ ứng tuyển',
  'Resumes': 'CV', '＋ New': '＋ Thêm mới',
  // statuses
  'draft': 'Nháp', 'applied': 'Đã nộp', 'screening': 'Sàng lọc', 'interview': 'Phỏng vấn', 'offer': 'Nhận offer',
  'rejected': 'Bị từ chối', 'withdrawn': 'Đã rút', 'all': 'tất cả',
  // dates, money
  'today': 'hôm nay', 'yesterday': 'hôm qua', '{n}d ago': '{n} ngày trước', 'in {n}d': '{n} ngày nữa',
  'posting closed': 'đã hết hạn', 'closes today': 'hết hạn hôm nay', 'closes in {n}d': 'còn {n} ngày',
  'Negotiable': 'Thỏa thuận', 'from ': 'từ ',
  // home
  '{open} open · {total} total': '{open} đang mở · {total} tất cả', 'Pipeline': 'Tiến trình', 'Needs attention': 'Cần xử lý',
  'No applications yet': 'Chưa có hồ sơ ứng tuyển nào',
  'Save a job from VietnamWorks or TopCV and it will show up here.': 'Lưu một tin tuyển dụng từ VietnamWorks hoặc TopCV, nó sẽ hiện ở đây.',
  '＋ Save your first job': '＋ Lưu công việc đầu tiên', 'Nothing waiting on you': 'Không có việc gì cần làm',
  'Every open application has moved recently.': 'Mọi hồ sơ đang mở đều có cập nhật gần đây.',
  // applications
  '{n} application': '{n} hồ sơ', '{n} applications': '{n} hồ sơ',
  'Search resumes, job descriptions, companies…': 'Tìm trong CV, mô tả công việc, công ty…', '＋ Save a job': '＋ Lưu công việc',
  'Salary': 'Lương', 'Applied': 'Ngày nộp', 'not sent': 'chưa gửi', 'Deadline': 'Hạn nộp', 'Follow-up': 'Nhắc liên hệ',
  'no resume attached': 'chưa đính kèm CV', 'No {s} applications.': 'Không có hồ sơ nào ở trạng thái “{s}”.',
  '{n} match': '{n} kết quả', '{n} matches': '{n} kết quả', 'job description': 'mô tả công việc', 'resume': 'CV', 'position': 'vị trí',
  // resumes
  '{n} version': '{n} phiên bản', '{n} versions': '{n} phiên bản', 'Compare selected': 'So sánh mục đã chọn',
  'Compare selected ({n}/2)': 'So sánh mục đã chọn ({n}/2)', 'rename': 'đổi tên',
  'Not sent to any application yet.': 'Chưa gửi cho hồ sơ nào.', 'Base resume': 'CV gốc',
  'The master you tailor from': 'Bản gốc để chỉnh theo từng công việc', 'open ↗': 'mở ↗', 'unset': 'bỏ chọn',
  'No base resume yet': 'Chưa có CV gốc',
  "Upload your master resume — every application's resume is then compared against it, so you see exactly what you tailored for each job. Or mark one of the versions below as the base.":
    'Tải lên CV gốc của bạn — CV của từng hồ sơ sẽ được so sánh với nó, để bạn thấy chính xác đã chỉnh gì cho từng công việc. Hoặc đánh dấu một phiên bản bên dưới làm CV gốc.',
  'Upload the base resume': 'Tải lên CV gốc', 'uploading…': 'đang tải lên…', 'Versions · {n}': 'Phiên bản · {n}',
  'No other versions yet. Attach a resume to an application and it shows up here.': 'Chưa có phiên bản nào khác. Đính kèm CV vào một hồ sơ, nó sẽ hiện ở đây.',
  'select to compare': 'chọn để so sánh', ' · first used {d}': ' · dùng lần đầu {d}', ' · in library': ' · trong thư viện',
  'reached {s}': 'đã đến: {s}', 'vs base': 'so với CV gốc', 'set as base': 'đặt làm CV gốc', 'Add a version': 'Thêm phiên bản',
  'Upload a resume that is not attached to an application': 'Tải lên CV chưa gắn với hồ sơ nào',
  // compare
  '⋯ {n} unchanged lines': '⋯ {n} dòng không đổi', 'identical text': 'nội dung giống hệt', '{n} changed': '{n} dòng sửa',
  '{n} added': '{n} dòng thêm', '{n} removed': '{n} dòng xóa', 'compare resumes': 'so sánh CV', 'Before': 'Trước', 'After': 'Sau',
  'sent to {x}': 'đã gửi cho {x}', 'not sent to any application': 'chưa gửi cho hồ sơ nào', '⇄ swap': '⇄ đổi chiều',
  // new
  'save a job': 'lưu công việc', 'Paste a job link — VietnamWorks, TopCV…': 'Dán link tin tuyển dụng — VietnamWorks, TopCV…',
  'Import': 'Nhập', 'Importing…': 'Đang nhập…', 'Click to choose, or drop a PDF here': 'Bấm để chọn, hoặc kéo thả file PDF vào đây',
  'Resume to send': 'CV sẽ gửi', 'Paste the job description if the import could not read it.': 'Dán mô tả công việc nếu không nhập tự động được.',
  'edit': 'sửa', 'Save application': 'Lưu hồ sơ', 'Saving…': 'Đang lưu…', 'Position': 'Vị trí', 'Job title *': 'Chức danh *',
  'Company *': 'Công ty *', 'Location': 'Địa điểm', 'Resume': 'CV', 'Job description': 'Mô tả công việc',
  'I have already applied': 'Tôi đã nộp hồ sơ', 'You already track this posting. ': 'Bạn đã lưu tin này rồi. ', 'Open it': 'Mở hồ sơ',
  ' — or save again to create a second record.': ' — hoặc lưu lần nữa để tạo bản thứ hai.',
  'Imported. Pick the resume you are sending and save.': 'Đã nhập. Chọn CV bạn sẽ gửi rồi bấm lưu.',
  'A job title and a company are required.': 'Cần có chức danh và tên công ty.',
  'Saved, but the resume upload failed: {e}': 'Đã lưu, nhưng tải CV lên thất bại: {e}', 'One-time setup': 'Cài đặt một lần',
  'Drag this button to your bookmarks bar.': 'Kéo nút này lên thanh dấu trang (bookmarks bar).',
  'Then on any VietnamWorks or TopCV job page, click it — the job opens here already filled in.':
    'Sau đó, trên trang tin tuyển dụng bất kỳ của VietnamWorks hoặc TopCV, bấm nút này — công việc sẽ mở ở đây với thông tin điền sẵn.',
  'Drag me to the bookmarks bar': 'Kéo tôi lên thanh dấu trang', '＋ Save to tracker': '＋ Lưu vào tracker',
  'Or paste a link': 'Hoặc dán link', 'Somewhere else? ': 'Trang khác? ', 'Fill it in by hand': 'Tự điền tay',
  // detail
  'Tailored for this job': 'Đã chỉnh cho công việc này',
  'Attach the resume you sent to see what you changed from your base.': 'Đính kèm CV bạn đã gửi để xem đã thay đổi gì so với CV gốc.',
  'No base resume set. ': 'Chưa đặt CV gốc. ', 'Choose one on the Resumes tab': 'Chọn một bản ở tab CV', ' to see what you tailored.': ' để xem bạn đã chỉnh gì.',
  'sent the base resume unchanged': 'đã gửi CV gốc, không chỉnh sửa', 'comparing with the base…': 'đang so sánh với CV gốc…',
  'side by side →': 'xem song song →', 'applied {d}': 'nộp {d}', 'not sent yet': 'chưa gửi', '⏳ closes ': '⏳ hạn ',
  '📨 applied ': '📨 đã nộp ', '🔔 follow up ': '🔔 nhắc liên hệ ', 'posting': 'tin tuyển dụng', 'application': 'hồ sơ',
  'Delete application': 'Xóa hồ sơ',
  'Delete this application?\n\n{name}\n\nIt moves to applications/_trash/ with its resume and notes, so it can be restored by moving the folder back.':
    'Xóa hồ sơ này?\n\n{name}\n\nHồ sơ sẽ được chuyển vào applications/_trash/ cùng CV và ghi chú, có thể khôi phục bằng cách chuyển thư mục về lại.',
  'Replace the resume': 'Thay CV', 'Attach the resume you sent': 'Đính kèm CV đã gửi',
  'Extracted {c} characters from {p} page(s).': 'Đã trích {c} ký tự từ {p} trang.', 'Resume sent': 'CV đã gửi',
  'No text layer found — search will not work on this PDF.': 'Không có lớp văn bản — không tìm kiếm được trong file PDF này.',
  '{p} page(s) · text extracted, searchable': '{p} trang · đã trích văn bản, tìm kiếm được', 'No resume attached yet.': 'Chưa đính kèm CV.',
  'resume preview': 'xem trước CV', 'Log something — recruiter replied, call booked…': 'Ghi chú — nhà tuyển dụng đã trả lời, đã hẹn gọi…',
  'resume attached · ': 'đã đính kèm CV · ', 'created': 'đã tạo', 'Paste the job description here.': 'Dán mô tả công việc vào đây.',
  'Save': 'Lưu', 'Cancel': 'Hủy', 'Timeline': 'Dòng thời gian', 'Log': 'Ghi',
  // AI tailoring
  'AI tailoring': 'Chỉnh CV bằng AI',
  'optional — not used for this job': 'tùy chọn — chưa dùng cho công việc này', 'suggestions ready — has problems': 'đã có gợi ý — có lỗi cần xem',
  'suggestions ready — {n} changes': 'đã có gợi ý — {n} thay đổi', 'Copied ✓': 'Đã chép ✓', 'copy': 'chép',
  'Set a base resume first. ': 'Hãy đặt CV gốc trước. ', 'Go to the Resumes tab': 'Mở tab CV',
  'Add the job description below first — tailoring is matched against it.': 'Hãy thêm mô tả công việc bên dưới trước — CV được chỉnh theo mô tả này.',
  'In Claude Code, opened in this project folder, run:': 'Trong Claude Code (mở tại thư mục dự án này), chạy:',
  'Claude reads your base resume — with your name, email, phone and links removed — and this job description, then writes suggestions you review here. Nothing is changed until you copy it.':
    'Claude đọc CV gốc của bạn — đã bỏ tên, email, số điện thoại và đường link — cùng mô tả công việc này, rồi viết gợi ý để bạn xem lại ở đây. Không có gì thay đổi cho đến khi bạn chép.',
  '{n} problems': '{n} lỗi', 'checked: no invented numbers': 'đã kiểm tra: không có số liệu bịa', '{n} to review': '{n} mục cần xem',
  'base resume changed since — run /tailor again': 'CV gốc đã đổi — hãy chạy lại /tailor', 'Requirements': 'Yêu cầu',
  'strong': 'đáp ứng tốt', 'weak': 'đáp ứng một phần', 'missing': 'còn thiếu',
  'Suggested changes · {n}': 'Gợi ý chỉnh sửa · {n}', 'accept this change': 'nhận thay đổi này',
  '{a} of {n} changes accepted': 'đã nhận {a}/{n} thay đổi', 'No changes suggested — your base resume already fits.': 'Không có gợi ý — CV gốc đã phù hợp.',
  'Copy tailored resume': 'Chép CV đã chỉnh', 'Copy Vietnamese version': 'Chép bản tiếng Việt',
  'The Vietnamese version is the full suggestion, not just accepted changes.': 'Bản tiếng Việt là toàn bộ gợi ý, không chỉ các thay đổi đã nhận.',
  'Vietnamese version': 'Bản tiếng Việt',
  '↑ moved up and reworded': '↑ chuyển lên và viết lại', '↓ moved down and reworded': '↓ chuyển xuống và viết lại',
  '↑ moved up · {n} lines': '↑ chuyển lên · {n} dòng', '↓ moved down · {n} lines': '↓ chuyển xuống · {n} dòng',
  '{n} moved': '{n} chuyển chỗ',
  '↑ moved up': '↑ chuyển lên', '↓ moved down': '↓ chuyển xuống', 'cut for this job': 'bỏ cho công việc này',
  // headings the importers write into jd.md
  'Description': 'Mô tả công việc', 'Requirements': 'Yêu cầu', 'Benefits': 'Quyền lợi', 'Skills': 'Kỹ năng',
};
/* Messages that come from the server in English. Patterns, because some carry numbers. */
const VI_SERVER = [
  [/^follow-up due \((\d+)d overdue\)$/, 'đến hạn liên hệ lại (trễ $1 ngày)'], [/^follow-up due$/, 'đến hạn liên hệ lại'],
  [/^draft - not sent yet$/, 'nháp - chưa gửi'], [/^draft - posting closes in (\d+)d$/, 'nháp - tin còn $1 ngày'],
  [/^draft - posting closes today$/, 'nháp - tin hết hạn hôm nay'], [/^draft - posting closed$/, 'nháp - tin đã hết hạn'],
  [/^no movement in (\d+)d$/, '$1 ngày không có cập nhật'],
  [/^That link is a list of jobs[\s\S]*$/, 'Link này là danh sách việc làm (kết quả tìm kiếm), không phải một tin tuyển dụng. Hãy mở công việc bạn muốn rồi dùng link của nó.'],
  [/^Found no job posting on that page[\s\S]*$/, 'Không tìm thấy tin tuyển dụng trên trang đó. Hãy tự điền thông tin bên dưới.'],
  [/^The job description could not be read[\s\S]*$/, 'Không đọc được mô tả công việc từ trang đó — hãy dán vào ô mô tả.'],
  [/^give a full http\(s\) job URL$/, 'Hãy dán link đầy đủ (bắt đầu bằng http/https).'],
  [/^a title and a company are required$/, 'Cần có chức danh và tên công ty.'],
  [/^(that file is not a PDF|upload a \.pdf file|give a \.pdf filename.*)$/, 'File này không phải PDF.'],
  [/^could not fetch that URL: ([\s\S]*)$/, 'Không tải được trang: $1'],
  [/^only (\d+) characters of text -- .*$/, 'Chỉ đọc được $1 ký tự — có vẻ đây là PDF dạng ảnh (scan), nên không tìm kiếm hay so sánh được.'],
  [/^unknown application$/, 'Không tìm thấy hồ sơ.'],
];
let LANG = (() => { try { return localStorage.getItem('rt-lang') || 'vi'; } catch { return 'vi'; } })();
const t = (s, vars = {}) => {
  const out = (LANG === 'vi' && VI[s]) || s;
  return out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
};
const tServer = s => {
  if (LANG !== 'vi' || !s) return s;
  for (const [rx, vi] of VI_SERVER) if (rx.test(s)) return s.replace(rx, vi);
  return s;
};
const st = s => t(s || 'draft');                   // status label
function setLang(l) {
  LANG = l;
  try { localStorage.setItem('rt-lang', l); } catch { /* private mode: still switches for this page */ }
  shell(); nav(); render();
}
/* The parts of the header that are not views: eyebrow and the EN | VI switch. */
function shell() {
  document.documentElement.lang = LANG;
  $('#eyebrow').textContent = t('Local · Private · Yours');
  const box = $('#lang'); box.textContent = '';
  for (const [l, name] of [['vi', 'Tiếng Việt'], ['en', 'English']])
    box.append(el('button', { class: LANG === l ? 'on' : '', title: name, 'aria-label': name,
                              'aria-pressed': String(LANG === l), onclick: () => setLang(l), html: FLAGS[l] }));
}
/* Inline SVG, not emoji: Windows renders flag emoji as the letters "VN" / "GB". */
const FLAGS = {
  vi: '<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#da251d"/>'
    + '<polygon fill="#ffdd00" points="15,3.6 16.35,7.75 20.7,7.75 17.18,10.3 18.52,14.45 15,11.9 11.48,14.45 12.82,10.3 9.3,7.75 13.65,7.75"/></svg>',
  en: '<svg viewBox="0 0 60 30" aria-hidden="true"><clipPath id="uk-s"><path d="M0,0v30h60v-30z"/></clipPath>'
    + '<clipPath id="uk-t"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><g clip-path="url(#uk-s)">'
    + '<path d="M0,0v30h60v-30z" fill="#012169"/><path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>'
    + '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#uk-t)" stroke="#c8102e" stroke-width="4"/>'
    + '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></g></svg>',
};

const STATUSES = ['draft', 'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'];
const PIPELINE = ['draft', 'applied', 'screening', 'interview', 'offer'];    // the forward path
const CLOSED = ['rejected', 'withdrawn'];

const money = s => {
  if (!s) return '—';
  if (s.negotiable) return t('Negotiable');
  const f = n => s.currency === 'VND' ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M ₫' : '$' + n.toLocaleString();
  if (s.min && s.max) return `${f(s.min)} – ${f(s.max)}`;
  if (s.min) return (s.open_ended ? t('from ') : '') + f(s.min);
  return s.raw || '—';
};
const daysFrom = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5) : null;
const ago = d => {
  const n = daysFrom(d);
  if (n === null) return '—';
  return n === 0 ? t('today') : n === -1 ? t('yesterday') : n < 0 ? t('{n}d ago', { n: -n }) : t('in {n}d', { n });
};
/* How urgent a deadline is, for coloring: closed / within 3 days / later. */
const deadlineInfo = d => {
  const n = daysFrom(d);
  if (n === null) return null;
  if (n < 0) return { cls: 'u-bad', text: t('posting closed') };
  if (n === 0) return { cls: 'u-bad', text: t('closes today') };
  return { cls: n <= 3 ? 'u-warn' : 'u-info', text: t('closes in {n}d', { n }) };
};
const pill = (text, cls) => el('span', { class: `pill ${cls}` }, [el('i'), text]);
const statusPill = s => pill(st(s), `st-${s || 'draft'}`);
const lbl = text => el('span', { class: 'lbl' }, text);
const b = text => el('b', {}, String(text));

/* Minimal renderer for the imported JD: "## " headings, "-"/"•" bullets, plain lines. */
function jdView(md) {
  const box = el('div', { class: 'jd' });
  let ul = null;
  for (const raw of (md || '').split('\n')) {
    const line = raw.trim();
    if (!line) { ul = null; continue; }
    if (line.startsWith('## ')) { ul = null; box.append(el('h4', {}, t(line.slice(3)))); continue; }
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
  const name = el('div', { class: 'muted sm' }, t('Click to choose, or drop a PDF here'));
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
    if (!v.label) continue;                 // hidden views (compare) are reached by link
    n.append(el('button', { class: (current === k ? 'on' : '') + (k === 'new' ? ' add' : ''), onclick: () => go(k) }, t(v.label)));
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
  catch (e) { sec.append(el('div', { class: 'note err' }, tServer(e.message))); }
}
const hud = (...parts) => { const h = $('#hdr'); h.textContent = ''; h.append(...parts); };

/* ---------------- Home ---------------- */
let listFilter = null;      // a status picked on Home carries over to Applications

register('home', 'Home', async sec => {
  const d = await api('/api/dashboard');
  hud(t('{open} open · {total} total', { open: d.open, total: d.total }));

  sec.append(el('div', { class: 'h', style: 'margin-top:0' }, t('Pipeline')));
  sec.append(el('div', { class: 'pipe' }, STATUSES.map((s, i) => el('button', {
    class: `tile rise st-${s}${d.by_status[s] ? '' : ' zero'}`, style: `--i:${i}`,
    onclick: () => { listFilter = s; go('applications'); }
  }, [el('div', { class: 'n' }, String(d.by_status[s] || 0)), el('div', { class: 'l' }, st(s))]))));

  sec.append(el('div', { class: 'h' }, t('Needs attention')));
  if (!d.total) {
    sec.append(el('div', { class: 'card empty' }, [
      el('div', { class: 'big' }, t('No applications yet')),
      el('div', {}, t('Save a job from VietnamWorks or TopCV and it will show up here.')),
      el('div', { style: 'margin-top:16px' }, [el('button', { class: 'btn pri big', onclick: () => go('new') }, t('＋ Save your first job'))])
    ]));
    return;
  }
  if (!d.attention.length) {
    sec.append(el('div', { class: 'card glow empty st-offer' }, [
      el('div', { class: 'big' }, t('Nothing waiting on you')),
      el('div', {}, t('Every open application has moved recently.'))
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
        pill(tServer(a.why), urgent)
      ])
    ]));
  });
});

/* ---------------- Applications ---------------- */
register('applications', 'Applications', async sec => {
  const apps = await api('/api/applications');
  hud(t(apps.length === 1 ? '{n} application' : '{n} applications', { n: apps.length }));

  const search = el('input', { class: 'hero', placeholder: t('Search resumes, job descriptions, companies…') });
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
      }, [s ? el('i') : '', s ? st(s) : t('all'), el('span', {}, String(count(s)))]));
    }
  };
  const drawList = () => {
    list.textContent = '';
    if (!apps.length) {
      list.append(el('div', { class: 'card empty' }, [
        el('div', { class: 'big' }, t('No applications yet')),
        el('div', { style: 'margin-top:14px' }, [el('button', { class: 'btn pri big', onclick: () => go('new') }, t('＋ Save a job'))])
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
          el('div', { class: 'm' }, [el('b', {}, t('Salary')), money(p.salary)]),
          el('div', { class: 'm' }, [el('b', {}, t('Applied')), a.applied_on ? ago(a.applied_on) : el('span', { class: 'faint' }, t('not sent'))]),
          el('div', { class: 'm' }, dl ? [el('b', {}, t('Deadline')), el('span', { class: dl.cls, style: 'color:var(--c)' }, dl.text)]
                                       : [el('b', {}, t('Follow-up')), a.follow_up_on ? ago(a.follow_up_on) : '—']),
          el('div', { class: 'cv', title: a.resume ? a.resume.file : t('no resume attached') }, a.resume ? '📄' : el('span', { class: 'faint' }, '·'))
        ])
      ]));
    });
    if (!shown.length) list.append(el('div', { class: 'card empty' }, t('No {s} applications.', { s: st(listFilter) })));
  };

  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      results.textContent = '';
      const q = search.value.trim();
      list.style.display = filters.style.display = q ? 'none' : '';
      if (!q) return;
      const hits = await api('/api/search?q=' + encodeURIComponent(q));
      results.append(el('div', { class: 'h' }, t(hits.length === 1 ? '{n} match' : '{n} matches', { n: hits.length })));
      const rx = new RegExp(q.split(/\s+/).map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'ig');
      hits.forEach((h, i) => {
        results.append(el('div', { class: 'card bar click rise u-warn', style: `--i:${i}`, onclick: () => go('detail', h.slug) }, [
          el('div', { class: 'row' }, [
            el('div', {}, [el('div', { style: 'font-weight:600' }, h.title || h.slug), el('div', { class: 'muted sm' }, h.company || '')]),
            el('div', { class: 'sp' }),
            ...h.where.map(w => pill(t(w === 'jd' ? 'job description' : w), 'u-info'))
          ]),
          h.snippet ? el('div', { class: 'hit', html: '…' + esc(h.snippet).replace(rx, m => `<mark>${m}</mark>`) + '…' }) : ''
        ]));
      });
    }, 220);
  });

  sec.append(search, filters, results, list);
  drawFilters(); drawList();
});

/* ---------------- Resumes ----------------
   Every distinct resume once (by content hash), however many applications sent it.
   The base is the master you tailor from; each version can be compared with it. */
const compareUrl = (a, b) => `/compare?a=${a}&b=${b}`;
function openCompare(a, b) {
  history.pushState({ key: 'compare' }, '', compareUrl(a, b));
  current = 'compare'; param = null; nav(); render();
}
const uploadVersion = (file, base) => file.arrayBuffer().then(buf =>
  api(`/api/resumes/upload?name=${encodeURIComponent(file.name)}${base ? '&base=1' : ''}`, { method: 'POST', body: buf }));

register('resumes', 'Resumes', async sec => {
  const { base, versions } = await api('/api/resumes');
  hud(t(versions.length === 1 ? '{n} version' : '{n} versions', { n: versions.length }));
  const baseV = versions.find(v => v.is_base);
  const picked = new Set();
  const compareBtn = el('button', { class: 'btn blue', disabled: '' }, t('Compare selected'));
  compareBtn.addEventListener('click', () => { const [x, y] = [...picked]; openCompare(x, y); });
  const msg = el('div');

  const label = v => {
    const shown = el('span', { class: 'vlabel' }, v.label);
    const edit = el('button', { class: 'linkbtn sm', style: 'margin-left:8px' }, t('rename'));
    edit.addEventListener('click', e => {
      e.stopPropagation();
      const inp = el('input', { value: v.label, style: 'max-width:340px;padding:5px 9px' });
      const done = async () => { await post(`/api/resumes/${v.sha}`, { label: inp.value }); render(); };
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') render(); });
      inp.addEventListener('blur', done);
      shown.replaceWith(inp); edit.remove(); inp.focus(); inp.select();
    });
    return el('span', {}, [shown, edit]);
  };
  const usedIn = v => v.apps.length
    ? el('div', { class: 'row wrap', style: 'gap:6px;margin-top:10px' }, v.apps.map(a =>
        el('button', { class: `chip st-${a.status}`, style: 'cursor:pointer', onclick: () => go('detail', a.slug) },
          [el('i', { class: 'dot' }), (a.company || a.slug).slice(0, 34), ' · ', st(a.status)])))
    : el('div', { class: 'faint sm', style: 'margin-top:8px' }, t('Not sent to any application yet.'));

  /* --- base --- */
  sec.append(el('div', { class: 'h', style: 'margin-top:0' }, t('Base resume')));
  if (baseV) {
    sec.append(el('div', { class: 'card glow st-offer' }, [
      el('div', { class: 'row wrap' }, [
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'eyebrow' }, t('The master you tailor from')),
          el('div', { style: 'font-family:var(--display);font-weight:700;font-size:20px;margin-top:8px' }, label(baseV)),
          el('div', { class: 'muted sm mono', style: 'margin-top:4px' }, `#${baseV.sha}`)
        ]),
        el('div', { class: 'sp' }),
        el('a', { class: 'btn', href: baseV.files[0], target: '_blank' }, t('open ↗')),
        el('button', { class: 'btn', onclick: async () => { await post(`/api/resumes/${baseV.sha}`, { base: false }); render(); } }, t('unset'))
      ]),
      usedIn(baseV)
    ]));
  } else {
    sec.append(el('div', { class: 'card glow st-applied' }, [
      el('div', { class: 'eyebrow' }, t('No base resume yet')),
      el('div', { style: 'margin:10px 0 12px' }, t("Upload your master resume — every application's resume is then compared against it, so you see exactly what you tailored for each job. Or mark one of the versions below as the base.")),
      dropzone(t('Upload the base resume'), async f => {
        msg.className = 'muted sm'; msg.textContent = t('uploading…');
        try { await uploadVersion(f, true); render(); }
        catch (e) { msg.className = 'note err'; msg.textContent = tServer(e.message); }
      }), msg
    ]));
  }

  /* --- versions --- */
  const others = versions.filter(v => !v.is_base);
  sec.append(el('div', { class: 'h' }, [t('Versions · {n}', { n: others.length })]));
  if (!others.length) sec.append(el('div', { class: 'card empty' }, t('No other versions yet. Attach a resume to an application and it shows up here.')));
  others.forEach((v, i) => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      box.checked ? picked.add(v.sha) : picked.delete(v.sha);
      if (picked.size > 2) { const first = [...picked][0]; picked.delete(first); sec.querySelector(`[data-sha="${first}"]`).checked = false; }
      compareBtn.disabled = picked.size !== 2;
      compareBtn.textContent = t('Compare selected ({n}/2)', { n: picked.size });
    });
    box.dataset.sha = v.sha;
    sec.append(el('div', { class: `card bar rise st-${v.best || 'draft'}`, style: `--i:${i}` }, [
      el('div', { class: 'row wrap' }, [
        el('label', { class: 'check', title: t('select to compare') }, [box]),
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { style: 'font-weight:600;font-size:15.5px' }, label(v)),
          el('div', { class: 'muted sm mono', style: 'margin-top:3px' },
            `#${v.sha}${v.first_used ? t(' · first used {d}', { d: v.first_used }) : ''}${v.in_library ? t(' · in library') : ''}`)
        ]),
        v.best ? pill(t('reached {s}', { s: st(v.best) }), `st-${v.best}`) : '',
        baseV ? el('button', { class: 'btn pri', onclick: () => openCompare(baseV.sha, v.sha) }, t('vs base')) : '',
        el('button', { class: 'btn', onclick: async () => { await post(`/api/resumes/${v.sha}`, { base: true }); render(); } }, t('set as base')),
        el('a', { class: 'btn', href: v.files[0], target: '_blank' }, t('open ↗'))
      ]),
      usedIn(v)
    ]));
  });
  if (others.length > 1 || (baseV && others.length)) sec.append(el('div', { class: 'row', style: 'margin-top:4px' }, [el('div', { class: 'sp' }), compareBtn]));

  if (baseV) {
    const m2 = el('div');
    sec.append(el('div', { class: 'h' }, t('Add a version')),
      el('div', { class: 'card' }, [dropzone(t('Upload a resume that is not attached to an application'), async f => {
        m2.className = 'muted sm'; m2.textContent = t('uploading…');
        try { await uploadVersion(f, false); render(); } catch (e) { m2.className = 'note err'; m2.textContent = tServer(e.message); }
      }), m2]));
  }
});

/* ---------------- Compare (opened from Resumes / an application; not a tab) ---------------- */
const marked = (text, marks, cls) => {
  const out = []; let at = 0;
  for (const [s, e] of marks || []) { out.push(text.slice(at, s), el('mark', { class: cls }, text.slice(s, e))); at = e; }
  out.push(text.slice(at));
  return out;
};
const diffCell = (side, r) => {
  const text = r[side];
  const cls = r.tag === 'equal' ? '' : text == null ? 'gap' : side === 'a' ? 'del' : 'ins';   // swap = removed | added
  return el('div', { class: `cell ${cls}` }, text == null ? '' :
    r.tag === 'replace' ? marked(text, r[side + '_marks'], side === 'a' ? 'del' : 'ins') : text);
};
/* Long runs of unchanged lines fold into one clickable row. */
function pairUp(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].tag !== 'delete') { out.push(rows[i++]); continue; }
    let j = i; while (j < rows.length && rows[j].tag === 'delete') j++;
    let k = j; while (k < rows.length && rows[k].tag === 'insert') k++;
    const dels = rows.slice(i, j), ins = rows.slice(j, k);
    for (let n = 0; n < Math.max(dels.length, ins.length); n++)
      out.push({ tag: 'swap', a: dels[n]?.a ?? null, b: ins[n]?.b ?? null, a_marks: [], b_marks: [] });
    i = k;
  }
  return out;
}
function diffRows(rows, keep = 2) {
  rows = pairUp(rows);
  const out = []; let i = 0;
  while (i < rows.length) {
    if (rows[i].tag !== 'equal') { out.push(rows[i++]); continue; }
    let j = i; while (j < rows.length && rows[j].tag === 'equal') j++;
    const run = rows.slice(i, j);
    const head = i === 0 ? 0 : keep, tail = j === rows.length ? 0 : keep;
    if (run.length > head + tail + 2) out.push(...run.slice(0, head), { fold: run.slice(head, run.length - tail) }, ...run.slice(run.length - tail));
    else out.push(...run);
    i = j;
  }
  return out;
}
function renderDiff(d) {
  const grid = el('div', { class: 'diff' });
  for (const r of diffRows(d.rows)) {
    if (r.fold) {
      const f = el('button', { class: 'fold' }, t('⋯ {n} unchanged lines', { n: r.fold.length }));
      f.addEventListener('click', () => f.replaceWith(...r.fold.flatMap(x => [diffCell('a', x), diffCell('b', x)])));
      grid.append(f);
    } else grid.append(diffCell('a', r), diffCell('b', r));
  }
  return grid;
}
const diffStats = d => el('div', { class: 'row wrap', style: 'gap:8px' }, d.added + d.removed + d.changed === 0
  ? [pill(t('identical text'), 'st-offer')]
  : [d.changed ? pill(t('{n} changed', { n: d.changed }), 'u-warn') : '', d.added ? pill(t('{n} added', { n: d.added }), 'st-offer') : '',
     d.removed ? pill(t('{n} removed', { n: d.removed }), 'st-rejected') : '']);

register('compare', null, async sec => {
  const q = new URLSearchParams(location.search);
  const { versions } = await api('/api/resumes');
  const a = q.get('a'), bb = q.get('b');
  const pick = (val, other) => {
    const s = el('select', { style: 'width:auto;min-width:0;max-width:100%' },
      versions.map(v => el('option', { value: v.sha, selected: v.sha === val ? '' : null }, `${v.is_base ? '★ ' : ''}${v.label} · #${v.sha}`)));
    s.addEventListener('change', () => openCompare(other === 'b' ? s.value : a, other === 'a' ? s.value : bb));
    return s;
  };
  hud(t('compare resumes'));
  const d = await api(`/api/diff?a=${a}&b=${bb}`);
  const va = versions.find(v => v.sha === a), vb = versions.find(v => v.sha === bb);
  const side = (v, sel, cls) => el('div', { class: `card ${cls}`, style: 'margin:0' }, [
    el('div', { class: 'eyebrow' }, t(cls === 'st-rejected' ? 'Before' : 'After')), el('div', { style: 'margin-top:10px' }, [sel]),
    v ? el('div', { class: 'muted sm', style: 'margin-top:8px' }, v.apps.length ? t('sent to {x}', { x: [...new Set(v.apps.map(x => x.company))].join(', ') }) : t('not sent to any application')) : ''
  ]);
  sec.append(
    el('div', { class: 'two', style: 'margin-bottom:14px' }, [side(va, pick(a, 'b'), 'st-rejected'), side(vb, pick(bb, 'a'), 'st-offer')]),
    el('div', { class: 'row wrap', style: 'margin-bottom:12px' }, [diffStats(d), el('div', { class: 'sp' }),
      el('button', { class: 'btn', onclick: () => openCompare(bb, a) }, t('⇄ swap'))]),
    el('div', { class: 'card', style: 'padding:0;overflow:hidden' }, [renderDiff(d)])
  );
});

/* ---------------- New ----------------
   Normal path: on a job page (VietnamWorks, TopCV, ...), click the "Save to tracker" bookmark. It opens
   /new?url=<that page>; the import runs by itself and fills everything, JD included.
   Nothing is created until Save is clicked, so no other site can write records here. */
register('new', '＋ New', async sec => {
  hud(t('save a job'));
  const url = el('input', { class: 'hero', placeholder: t('Paste a job link — VietnamWorks, TopCV…') });
  const importBtn = el('button', { class: 'btn blue big' }, t('Import'));
  const msg = el('div');
  const f = {};
  const field = (k, label) => el('div', {}, [lbl(t(label)), f[k] = el('input')]);
  const pdf = dropzone(t('Resume to send'));
  f.applied = el('input', { type: 'checkbox' });
  f.jd = el('textarea', { placeholder: t('Paste the job description if the import could not read it.') });
  let imported = null;

  const jdBox = el('div', { style: 'margin-top:12px' });
  const showJd = () => {
    jdBox.textContent = '';
    if (!f.jd.value.trim()) { jdBox.append(f.jd); return; }
    jdBox.append(jdView(f.jd.value), el('button', {
      class: 'linkbtn sm', style: 'margin-top:10px', onclick: () => { jdBox.textContent = ''; jdBox.append(f.jd); f.jd.focus(); }
    }, t('edit')));
  };
  const facts = el('div', { class: 'facts' });
  f.save = el('button', { class: 'btn pri big' }, t('Save application'));
  const form = el('div', { style: 'display:none' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow st-applied' }, t('Position')),
      facts,
      el('div', { style: 'margin-top:16px' }, [field('title', 'Job title *')]),
      el('div', { class: 'grid2', style: 'margin-top:14px' }, [field('company', 'Company *'), field('location', 'Location')])
    ]),
    el('div', { class: 'card' }, [el('div', { class: 'eyebrow st-interview' }, t('Resume')), el('div', { style: 'margin-top:12px' }, [pdf])]),
    el('div', { class: 'card' }, [el('div', { class: 'eyebrow', style: '--c:var(--pink)' }, t('Job description')), jdBox]),
    el('div', { class: 'row wrap', style: 'margin-top:6px' }, [
      el('label', { class: 'check' }, [f.applied, t('I have already applied')]),
      el('div', { class: 'sp' }),
      f.save
    ])
  ]);
  const reveal = () => { form.style.display = ''; showJd(); };

  const doImport = async () => {
    msg.textContent = ''; msg.className = '';
    if (!url.value.trim()) return;
    importBtn.disabled = true; importBtn.textContent = t('Importing…');
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
        msg.append(t('You already track this posting. '),
          el('button', { class: 'linkbtn', onclick: () => go('detail', d.existing[0]) }, t('Open it')),
          t(' — or save again to create a second record.'));
      } else if (d.note) {
        msg.className = 'note warn'; msg.textContent = tServer(d.note);
      } else {
        msg.className = 'note ok'; msg.textContent = t('Imported. Pick the resume you are sending and save.');
      }
      reveal();
    } catch (e) { msg.className = 'note err'; msg.textContent = tServer(e.message); }
    importBtn.disabled = false; importBtn.textContent = t('Import');
  };
  importBtn.addEventListener('click', doImport);
  url.addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });

  f.save.addEventListener('click', async () => {
    const position = Object.assign({}, imported || {}, {
      title: f.title.value.trim(), company: f.company.value.trim(), location: f.location.value.trim() || null
    });
    if (!position.title || !position.company) {
      msg.className = 'note err'; msg.textContent = t('A job title and a company are required.'); window.scrollTo(0, 0); return;
    }
    f.save.disabled = true; f.save.textContent = t('Saving…');
    try {
      const d = await post('/api/application', { position, jd: f.jd.value, status: f.applied.checked ? 'applied' : 'draft' });
      if (pdf.file) {
        try { await uploadPdf(d.slug, pdf.file); }
        catch (e) { alert(t('Saved, but the resume upload failed: {e}', { e: tServer(e.message) })); }
      }
      go('detail', d.slug);
    } catch (e) {
      msg.className = 'note err'; msg.textContent = tServer(e.message);
      f.save.disabled = false; f.save.textContent = t('Save application');
    }
  });

  const bookmarklet = `javascript:void(window.open('${location.origin}/new?url='+encodeURIComponent(location.href),'_blank'))`;
  sec.append(
    el('div', { class: 'card glow st-offer' }, [
      el('div', { class: 'eyebrow' }, t('One-time setup')),
      el('div', { class: 'row wrap', style: 'margin-top:12px' }, [
        el('div', { style: 'flex:1;min-width:260px' }, [
          el('div', { style: 'font-weight:600' }, t('Drag this button to your bookmarks bar.')),
          el('div', { class: 'muted sm' }, t('Then on any VietnamWorks or TopCV job page, click it — the job opens here already filled in.'))
        ]),
        el('a', { href: bookmarklet, class: 'grab', title: t('Drag me to the bookmarks bar'), onclick: e => e.preventDefault() }, t('＋ Save to tracker'))
      ])
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow st-applied' }, t('Or paste a link')),
      el('div', { class: 'row', style: 'margin-top:12px' }, [url, importBtn]),
      el('div', { class: 'sm faint', style: 'margin-top:10px' }, [
        t('Somewhere else? '), el('button', { class: 'linkbtn', onclick: reveal }, t('Fill it in by hand'))
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

/* "AI tailoring": the result of /tailor (run in Claude Code), reviewed change by change.
   The AI never edits anything; the user copies the accepted text into their resume document. */
const STRENGTH = { strong: 'st-offer', weak: 'u-warn', missing: 'st-rejected' };
const copyText = async (text, btn) => {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  const was = btn.textContent; btn.textContent = t('Copied ✓'); setTimeout(() => { btn.textContent = was; }, 1500);
};

const normLine = s => String(s || '').replace(/\s+/g, ' ').trim();
/* Diff rows -> reviewable changes. A line deleted in one place and inserted unchanged in another
   is ONE 'move' (two checkboxes would let a move duplicate or drop the line); a run of deletes
   followed by inserts reads as one rewrite. Pure: tested from Node. */
function groupChanges(raw) {
  const moved = new Map(), changes = [], freeIns = new Map();
  raw.forEach((row, i) => { if (row.tag === 'insert') { const k = normLine(row.b); if (!freeIns.has(k)) freeIns.set(k, []); freeIns.get(k).push(i); } });
  raw.forEach((row, i) => {
    const j = row.tag === 'delete' ? (freeIns.get(normLine(row.a)) || []).shift() : undefined;
    if (j === undefined) return;
    const c = { kind: 'move', idxs: [i, j], text: row.a, first: Math.min(i, j), up: j < i };
    changes.push(c); moved.set(i, c); moved.set(j, c);
  });
  // Reworded *and* moved: pair a leftover delete with the most similar leftover insert
  // (same test as the server's line pairing: half the words in common).
  const similar = (a, b) => {
    const A = normLine(a).split(' '), B = normLine(b).split(' '), pool = new Map();
    for (const w of B) pool.set(w, (pool.get(w) || 0) + 1);
    let common = 0;
    for (const w of A) if (pool.get(w)) { common++; pool.set(w, pool.get(w) - 1); }
    return 2 * common / (A.length + B.length);
  };
  raw.forEach((row, i) => {
    if (row.tag !== 'delete' || moved.has(i)) return;
    let best = -1, score = 0.5;
    raw.forEach((o, j) => { if (o.tag === 'insert' && !moved.has(j) && Math.abs(j - i) > 1) { const sc = similar(row.a, o.b); if (sc >= score) { best = j; score = sc; } } });
    if (best < 0) return;
    const c = { kind: 'move', reworded: true, idxs: [i, best], text: row.a, b: raw[best].b, first: Math.min(i, best), up: best < i };
    changes.push(c); moved.set(i, c); moved.set(best, c);
  });
  for (let i = 0; i < raw.length;) {
    if (raw[i].tag === 'equal' || moved.has(i)) { i++; continue; }
    const idxs = [];
    if (raw[i].tag === 'replace') idxs.push(i++);
    else {
      while (i < raw.length && raw[i].tag === 'delete' && !moved.has(i)) idxs.push(i++);
      while (i < raw.length && raw[i].tag === 'insert' && !moved.has(i)) idxs.push(i++);
    }
    changes.push({ kind: 'edit', idxs, first: idxs[0] });
  }
  // A section moved as a whole arrives as many single-line moves whose old and new positions
  // are both consecutive (only unchanged rows between them): merge each run into one block.
  const moves = changes.filter(c => c.kind === 'move' && !c.reworded).sort((x, y) => x.idxs[0] - y.idxs[0]);
  const adjacent = (a, b) => { for (let k = a + 1; k < b; k++) if (raw[k].tag !== 'equal' && !moved.has(k)) return false; return true; };
  const blocks = [];
  for (const m of moves) {
    const prev = blocks[blocks.length - 1], last = prev && prev[prev.length - 1];
    if (last && adjacent(last.idxs[0], m.idxs[0]) && adjacent(last.idxs[1], m.idxs[1]) && m.idxs[1] > last.idxs[1] && last.up === m.up) prev.push(m);
    else blocks.push([m]);
  }
  for (const run of blocks.filter(b => b.length > 1)) {
    for (const m of run) changes.splice(changes.indexOf(m), 1);
    const idxs = run.flatMap(m => m.idxs);
    changes.push({ kind: 'move', block: true, idxs, texts: run.map(m => m.text), text: run[0].text, first: Math.min(...idxs), up: run[0].up });
  }
  changes.sort((x, y) => x.first - y.first);
  return { changes, changeOf: new Map(changes.flatMap(c => c.idxs.map(i => [i, c]))) };
}
/* Accepted change -> its new side; rejected -> the base line stays where it was. */
function assembleTailored(raw, changeOf, accepted) {
  return raw.flatMap((row, i) => {
    if (row.tag === 'equal') return [row.a];
    const on = accepted.has(changeOf.get(i));
    if (row.tag === 'replace') return [on ? row.b : row.a];
    if (row.tag === 'delete') return on ? [] : [row.a];
    return on ? [row.b] : [];
  }).join('\n');
}

/* Folded by default: using AI on a resume is a choice, not the default view. The fold shows a
   one-line status; the full review is drawn the first time it is opened. */
function tailorSection(slug) {
  const status = el('span', { class: 'faint sm' });
  const body = el('div', { style: 'margin-top:12px' });
  const card = el('details', { class: 'card fold-card' }, [
    el('summary', {}, [el('span', { class: 'eyebrow', style: '--c:var(--violet)' }, t('AI tailoring')), el('span', { class: 'sp' }), status]),
    body]);
  let data = null, drawn = false;
  const draw = () => { if (data && card.open && !drawn) { drawn = true; drawTailor(body, data, slug); } };
  card.addEventListener('toggle', draw);
  api(`/api/application/${slug}/tailor`).then(d => {
    data = d;
    const r = d.result;
    status.textContent = !r ? t('optional — not used for this job')
      : r.problems?.some(p => p.level === 'error') ? t('suggestions ready — has problems')
      : t('suggestions ready — {n} changes', { n: r.diff.added + r.diff.removed + r.diff.changed > 0 ? groupChanges(r.diff.rows).changes.length : 0 });
    draw();
  }).catch(e => { status.textContent = tServer(e.message); });
  return card;
}

function drawTailor(body, d, slug) {
  body.textContent = '';
  const r = d.result;
  if (!r) {
    if (!d.ready.base) { body.append(el('div', { class: 'muted sm' }, [t('Set a base resume first. '), el('button', { class: 'linkbtn', onclick: () => go('resumes') }, t('Go to the Resumes tab'))])); return; }
    if (!d.ready.jd) { body.append(el('div', { class: 'muted sm' }, t('Add the job description below first — tailoring is matched against it.'))); return; }
    const copy = el('button', { class: 'btn' }, t('copy'));
    copy.addEventListener('click', () => copyText(d.command, copy));
    body.append(
      el('div', { class: 'sm' }, t('In Claude Code, opened in this project folder, run:')),
      el('div', { class: 'row', style: 'margin:10px 0' }, [el('code', { class: 'cmd' }, d.command), copy]),
      el('div', { class: 'muted sm' }, t('Claude reads your base resume — with your name, email, phone and links removed — and this job description, then writes suggestions you review here. Nothing is changed until you copy it.')));
    return;
  }
  const errors = (r.problems || []).filter(p => p.level === 'error'), warns = (r.problems || []).filter(p => p.level === 'warn');
  body.append(el('div', { class: 'row wrap', style: 'gap:8px' }, [
    errors.length ? pill(t('{n} problems', { n: errors.length }), 'u-bad') : pill(t('checked: no invented numbers'), 'st-offer'),
    warns.length ? pill(t('{n} to review', { n: warns.length }), 'u-warn') : '',
    r.stale ? pill(t('base resume changed since — run /tailor again'), 'u-warn') : '',
    el('div', { class: 'sp' }), el('span', { class: 'faint sm mono' }, r.prepared_at ? r.prepared_at.replace('T', ' ') : '')
  ]));
  if (r.summary) body.append(el('p', { class: 'sm', style: 'margin:12px 0 0;color:#cdd6e2' }, r.summary));
  if (errors.length) body.append(el('div', { class: 'note err' }, errors.map(p => el('div', {}, p.message))));

  /* requirements */
  if (r.gaps?.length) {
    const order = { strong: 0, weak: 1, missing: 2 };
    const count = s => r.gaps.filter(g => g.strength === s).length;
    body.append(el('div', { class: 'h' }, [t('Requirements'), ' · ', ...['strong', 'weak', 'missing'].map(s => pill(`${count(s)} ${t(s)}`, STRENGTH[s]))]));
    const list = el('div', { class: 'gaps' });
    for (const g of r.gaps.slice().sort((a, b) => order[a.strength] - order[b.strength])) {
      list.append(el('div', { class: `gap bar ${STRENGTH[g.strength] || ''}` }, [
        el('div', { class: 'row wrap', style: 'gap:10px' }, [pill(t(g.strength), STRENGTH[g.strength] || 'u-info'), el('b', {}, g.requirement)]),
        g.evidence?.length ? el('div', { class: 'ev-q' }, g.evidence.map(e => el('div', {}, e))) : '',
        g.advice ? el('div', { class: 'sm', style: 'margin-top:6px' }, ['→ ', g.advice]) : ''
      ]));
    }
    body.append(list);
  }

  /* suggested changes, each accept-able. A line removed in one place and added unchanged in
     another is ONE "moved" change -- two checkboxes would let a move duplicate or drop a line. */
  const raw = r.diff.rows;
  const norm = normLine;
  const { changes, changeOf } = groupChanges(raw);
  const accepted = new Set(changes);
  const why = new Map((r.notes || []).map(n => [norm(n.line), n]));
  const flagged = line => warns.concat(errors).filter(p => line && p.message.includes(line.slice(0, 60)));
  const counter = el('span', { class: 'muted sm' });
  const setCount = () => { counter.textContent = t('{a} of {n} changes accepted', { a: accepted.size, n: changes.length }); };
  body.append(el('div', { class: 'h' }, t('Suggested changes · {n}', { n: changes.length })));
  const list = el('div', { class: 'chg' });
  for (const c of changes) {
    const box = el('input', { type: 'checkbox', checked: '' });
    const lines = [];
    let newLines = [];
    if (c.kind === 'move' && c.reworded) {
      lines.push(el('div', { class: 'mvtag', style: 'margin:2px 0 4px' }, t(c.up ? '↑ moved up and reworded' : '↓ moved down and reworded')),
                 el('div', { class: 'cell del' }, c.text), el('div', { class: 'cell ins' }, c.b));
      newLines = [c.b];
    } else if (c.kind === 'move' && c.block) {
      lines.push(el('div', { class: 'mvtag', style: 'margin:2px 0 4px' }, t(c.up ? '↑ moved up · {n} lines' : '↓ moved down · {n} lines', { n: c.texts.length })),
                 ...c.texts.map(x => el('div', { class: 'cell mv' }, x)));
      newLines = c.texts;
    } else if (c.kind === 'move') {
      lines.push(el('div', { class: 'cell mv' }, [el('span', { class: 'mvtag' }, t(c.up ? '↑ moved up' : '↓ moved down')), ' ', c.text]));
      newLines = [c.text];
    } else for (const i of c.idxs) {
      const row = raw[i];
      if (row.a != null) lines.push(el('div', { class: 'cell del' }, row.tag === 'replace' ? marked(row.a, row.a_marks, 'del') : row.a));
      if (row.b != null) { lines.push(el('div', { class: 'cell ins' }, row.tag === 'replace' ? marked(row.b, row.b_marks, 'ins') : row.b)); newLines.push(row.b); }
    }
    if (c.kind === 'edit' && !newLines.length) lines.push(el('div', { class: 'why' }, t('cut for this job')));
    const notes = newLines.map(l => why.get(norm(l))).filter(Boolean);
    const item = el('div', { class: 'tchg' }, [
      el('label', { class: 'check', title: t('accept this change') }, [box]),
      el('div', { style: 'min-width:0;flex:1' }, [
        ...lines,
        ...notes.map(n => el('div', { class: 'why' }, [n.requirement ? el('b', {}, n.requirement + ': ') : '', n.why])),
        ...newLines.flatMap(flagged).map(p => el('div', { class: `why ${p.level === 'error' ? 'bad' : 'warn'}` }, '⚠ ' + p.message))
      ])
    ]);
    box.addEventListener('change', () => { box.checked ? accepted.add(c) : accepted.delete(c); item.classList.toggle('off', !box.checked); setCount(); });
    list.append(item);
  }
  if (!changes.length) list.append(el('div', { class: 'cell' }, t('No changes suggested — your base resume already fits.')));
  body.append(list);
  setCount();

  const assemble = () => assembleTailored(raw, changeOf, accepted);
  const copyEn = el('button', { class: 'btn pri' }, t('Copy tailored resume'));
  copyEn.addEventListener('click', () => copyText(assemble(), copyEn));
  const copyVi = el('button', { class: 'btn' }, t('Copy Vietnamese version'));
  copyVi.addEventListener('click', () => copyText(r.tailored_vi, copyVi));
  body.append(el('div', { class: 'row wrap', style: 'margin-top:14px' }, [counter, el('div', { class: 'sp' }), copyEn, r.tailored_vi ? copyVi : '']));
  body.append(el('div', { class: 'faint sm', style: 'margin-top:8px' }, t('The Vietnamese version is the full suggestion, not just accepted changes.')));
  if (r.tailored_vi) body.append(el('details', { class: 'vi' }, [el('summary', {}, t('Vietnamese version')), el('div', { class: 'vi-text' }, r.tailored_vi)]));
}

/* ---------------- Detail ---------------- */
/* "What changed for this job": this application's resume against the base, changes only. */
function changesCard(a) {
  const card = el('div', { class: 'card' }, [el('div', { class: 'eyebrow u-warn' }, t('Tailored for this job'))]);
  const body = el('div', { style: 'margin-top:12px' });
  card.append(body);
  if (!a.resume_sha) { body.append(el('div', { class: 'muted sm' }, t('Attach the resume you sent to see what you changed from your base.'))); return card; }
  if (!a.base_sha) {
    body.append(el('div', { class: 'muted sm' }, [t('No base resume set. '), el('button', { class: 'linkbtn', onclick: () => go('resumes') }, t('Choose one on the Resumes tab')), t(' to see what you tailored.')]));
    return card;
  }
  if (a.base_sha === a.resume_sha) { body.append(pill(t('sent the base resume unchanged'), 'st-draft')); return card; }
  body.append(el('div', { class: 'muted sm' }, t('comparing with the base…')));
  api(`/api/diff?a=${a.base_sha}&b=${a.resume_sha}`).then(d => {
    body.textContent = '';
    const { changes } = groupChanges(d.rows);
    // Count what was rewritten, added or cut -- moved lines are counted once, as moves, below.
    const stats = { added: 0, removed: 0, changed: 0 };
    for (const c of changes) {
      if (c.kind === 'move') { if (c.reworded) stats.changed++; continue; }
      for (const i of c.idxs) stats[{ replace: 'changed', insert: 'added', delete: 'removed' }[d.rows[i].tag]]++;
    }
    body.append(el('div', { class: 'row wrap' }, [diffStats(stats), el('div', { class: 'sp' }),
      el('button', { class: 'btn', onclick: () => openCompare(a.base_sha, a.resume_sha) }, t('side by side →'))]));
    const moves = changes.filter(c => c.kind === 'move' && !c.reworded);
    if (moves.length) body.append(el('div', { style: 'margin-top:8px' }, [pill(t('{n} moved', { n: moves.reduce((n, c) => n + (c.texts || [c.text]).length, 0) }), 'u-info')]));
    const list = el('div', { class: 'chg' });
    for (const c of changes) {
      if (c.kind === 'move' && !c.reworded) continue;           // order-only changes: counted above, not listed
      const rows = c.reworded ? [{ tag: 'delete', a: c.text }, { tag: 'insert', b: c.b }] : c.idxs.map(i => d.rows[i]);
      for (const r of rows) {
        if (r.a != null) list.append(el('div', { class: 'cell del' }, r.tag === 'replace' ? marked(r.a, r.a_marks, 'del') : r.a));
        if (r.b != null) list.append(el('div', { class: 'cell ins' }, r.tag === 'replace' ? marked(r.b, r.b_marks, 'ins') : r.b));
      }
    }
    if (list.childElementCount) body.append(list);
  }).catch(e => { body.textContent = tServer(e.message); });
  return card;
}

async function detailView(sec, slug) {
  const a = await api('/api/application/' + encodeURIComponent(slug));
  const pos = a.position || {};
  const reload = () => go('detail', slug, false);
  hud(statusPill(a.status), ' ', a.applied_on ? t('applied {d}', { d: ago(a.applied_on) }) : t('not sent yet'));

  const setStatus = async s => { if (s !== a.status) { await post(`/api/application/${slug}/status`, { status: s }); reload(); } };
  const at = PIPELINE.indexOf(a.status);
  const stepper = el('div', { class: 'stepper' }, [
    ...PIPELINE.map((s, i) => el('button', {
      class: `st-${s}${s === a.status ? ' on' : at > i ? ' past' : ''}`, onclick: () => setStatus(s)
    }, st(s))),
    el('span', { class: 'gap' }),
    ...CLOSED.map(s => el('button', { class: `st-${s}${s === a.status ? ' on' : ''}`, onclick: () => setStatus(s) }, st(s)))
  ]);

  const fu = el('input', { type: 'date', value: a.follow_up_on || '', style: 'width:auto;padding:2px 6px;border-radius:6px' });
  fu.addEventListener('change', async () => { await post(`/api/application/${slug}/fields`, { follow_up_on: fu.value || null }); reload(); });

  const dl = deadlineInfo(pos.deadline);
  const facts = el('div', { class: 'facts' }, [
    pos.salary ? el('span', { class: 'chip' }, ['💰 ', b(money(pos.salary))]) : '',
    pos.location ? el('span', { class: 'chip' }, ['📍 ', pos.location]) : '',
    dl && a.status === 'draft' ? pill(`${dl.text} · ${pos.deadline}`, dl.cls) : pos.deadline ? el('span', { class: 'chip' }, [t('⏳ closes '), pos.deadline]) : '',
    a.applied_on ? el('span', { class: 'chip' }, [t('📨 applied '), b(a.applied_on)]) : '',
    el('span', { class: 'chip' }, [t('🔔 follow up '), fu]),
    pos.contact_email ? el('span', { class: 'chip' }, ['✉️ ', el('a', { href: `mailto:${pos.contact_email}` }, pos.contact_email)]) : '',
    pos.url ? el('span', { class: 'chip' }, ['🔗 ', el('a', { href: pos.url, target: '_blank', rel: 'noopener noreferrer' }, pos.source || t('posting'))]) : ''
  ]);

  sec.append(el('div', { class: `card glow st-${a.status}` }, [
    el('div', { class: 'eyebrow' }, pos.company || t('application')),
    el('h2', { class: 'title' }, pos.title || slug),
    facts, stepper,
    el('div', { class: 'row', style: 'margin-top:14px' }, [el('div', { class: 'sp' }), el('button', {
      class: 'btn danger', onclick: async () => {
        const name = `${pos.title || slug}${pos.company ? ' — ' + pos.company : ''}`;
        if (!confirm(t('Delete this application?\n\n{name}\n\nIt moves to applications/_trash/ with its resume and notes, so it can be restored by moving the folder back.', { name }))) return;
        await post(`/api/application/${slug}/delete`, {});
        go('applications');
      }
    }, t('Delete application'))])
  ]));
  sec.append(tailorSection(slug));      // right under the header: the first thing to review after /tailor

  /* --- resume --- */
  const upMsg = el('div');
  const zone = dropzone(t(a.resume ? 'Replace the resume' : 'Attach the resume you sent'), async file => {
    upMsg.className = 'muted sm'; upMsg.textContent = t('uploading…');
    try {
      const d = await uploadPdf(slug, file);
      upMsg.className = d.warning ? 'note warn' : 'note ok';
      upMsg.textContent = tServer(d.warning) || t('Extracted {c} characters from {p} page(s).', { c: d.extracted_chars, p: d.pages });
      setTimeout(reload, 900);
    } catch (e) { upMsg.className = 'note err'; upMsg.textContent = tServer(e.message); }
  });
  const pdfUrl = a.resume ? `/applications/${slug}/${encodeURIComponent(a.resume.file)}` : null;
  const left = el('div', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('div', { class: 'eyebrow st-interview' }, t('Resume sent')), el('div', { class: 'sp' }),
                                   pdfUrl ? el('a', { class: 'btn', href: pdfUrl, target: '_blank' }, t('open ↗')) : '']),
      a.resume ? el('div', { style: 'margin:12px 0' }, [
        el('div', { style: 'font-weight:600' }, a.resume.file),
        a.resume.text_ok === false
          ? el('div', { class: 'note warn' }, t('No text layer found — search will not work on this PDF.'))
          : el('div', { class: 'muted sm' }, t('{p} page(s) · text extracted, searchable', { p: a.resume.pages }))
      ]) : el('div', { class: 'muted sm', style: 'margin:10px 0' }, t('No resume attached yet.')),
      zone, upMsg
    ]),
    changesCard(a),
    pdfUrl ? el('iframe', { class: 'pdf', src: pdfUrl + '#view=FitH', title: t('resume preview') }) : ''
  ]);

  /* --- timeline + jd --- */
  const evText = el('input', { placeholder: t('Log something — recruiter replied, call booked…') });
  const addEv = async () => {
    if (!evText.value.trim()) return;
    await post(`/api/application/${slug}/event`, { text: evText.value.trim() });
    reload();
  };
  evText.addEventListener('keydown', e => { if (e.key === 'Enter') addEv(); });
  const evLine = e => {
    if (e.type === 'status') return [`${e.from ? st(e.from) : '—'} → `, b(st(e.to))];
    if (e.type === 'resume') return [t('resume attached · '), el('span', { class: 'muted' }, e.text)];
    return [e.text || t(e.type)];
  };
  const evColor = e => e.type === 'status' ? `st-${e.to}` : e.type === 'resume' ? 'st-interview' : e.type === 'created' ? 'st-draft' : 'u-warn';

  const jd = el('textarea', { placeholder: t('Paste the job description here.') });
  jd.value = a.jd || '';
  const jdBox = el('div', { style: 'margin-top:12px' });
  const jdEdit = el('button', { class: 'btn' }, t('edit'));
  const showJd = editing => {
    jdBox.textContent = '';
    jdEdit.style.display = editing || !a.jd ? 'none' : '';
    if (editing || !a.jd) {
      jdBox.append(jd, el('div', { class: 'row', style: 'margin-top:10px' }, [
        el('button', { class: 'btn pri', onclick: async () => { await post(`/api/application/${slug}/jd`, { jd: jd.value }); reload(); } }, t('Save')),
        a.jd ? el('button', { class: 'btn', onclick: () => showJd(false) }, t('Cancel')) : ''
      ]));
    } else jdBox.append(jdView(a.jd));
  };
  jdEdit.addEventListener('click', () => showJd(true));
  showJd(false);

  const right = el('div', {}, [
    el('div', { class: 'card' }, [
      el('div', { class: 'eyebrow u-warn' }, t('Timeline')),
      el('div', { class: 'tl', style: 'margin-top:14px' }, (a.events || []).slice().reverse().map(e =>
        el('div', { class: `ev ${evColor(e)}` }, [el('i'), el('div', { class: 'w' }, evLine(e)), el('div', { class: 'd' }, `${e.on} · ${ago(e.on)}`)]))),
      el('div', { class: 'row', style: 'margin-top:4px' }, [evText, el('button', { class: 'btn', onclick: addEv }, t('Log'))])
    ]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [el('div', { class: 'eyebrow', style: '--c:var(--pink)' }, t('Job description')), el('div', { class: 'sp' }), jdEdit]),
      jdBox
    ])
  ]);

  sec.append(el('div', { class: 'two' }, [left, right]));
}

/* ---------------- boot ---------------- */
(function boot() {
  const r = route(); current = r.key; param = r.p;
  shell(); nav(); render();
})();
