import * as S from './services.js';
import { db, collection, doc, getDocs, query, where, orderBy, limit, startAfter, getCountFromServer } from './api.js';
import { state, navigate } from './state.js';
import { h, empty, loading, modal, confirmDialog, toast, busy, copyText, download, fmtDate, fmtN, fmtPct, fmtDur, toInputDT, fromInputDT, avatar } from './ui.js';
import { ms, USER_META, STATUS_LABEL, statusClass, loadSummaries, loadAttempts, availability } from './data.js';
import { parseExamJson, validateExam, DEFAULT_POINTS } from './validation.js';

const stat = (label, value, sub) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label), sub && h('div', { class: 'small muted' }, sub));
const head = (title, ...right) => h('div', { class: 'row between', style: { marginBottom: '16px' } }, h('h1', { style: { margin: 0 } }, title), h('div', { class: 'row' }, ...right));
const th = (cols) => h('thead', {}, h('tr', {}, cols.map((t) => h('th', {}, t))));
const td = (label, ...c) => h('td', { 'data-label': label }, ...c);
const count = async (q) => (await getCountFromServer(q)).data().count;
const tsDate = (t) => fmtDate(ms(t));

// ===================== OVERVIEW =====================
export async function overview(v) {
  const now = Date.now(), { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const A = collection(db, 'attempts'), E = collection(db, 'exams');
  const [users, exams, pub, up, att, comp, sums, top, logs] = await Promise.all([
    count(collection(db, 'users')), count(E), count(query(E, where('publicationStatus', '==', 'published'))),
    count(query(E, where('publicationStatus', '==', 'published'), where('openingAt', '>', Timestamp.fromMillis(now)))),
    count(A), count(query(A, where('status', 'in', ['submitted', 'timed_out']))), loadSummaries(),
    getDocs(query(A, orderBy('startedAt', 'desc'), limit(300))), getDocs(query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(10))),
  ]);
  const n = sums.reduce((t, s) => t + (s.completedAttempts || 0), 0), acc = n ? sums.reduce((t, s) => t + (s.accuracySum || 0), 0) / n : null;
  const tally = {}; top.docs.forEach((d) => { const t = d.data().examTitle; tally[t] = (tally[t] || 0) + 1; }); const topList = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5);
  v.replaceChildren(head('Administration'), h('div', { class: 'grid g4' }, stat('Registered users', users), stat('Examinations', exams), stat('Published', pub), stat('Upcoming', up), stat('Total attempts', att), stat('Completed attempts', comp), stat('Average accuracy', fmtPct(acc))),
    h('div', { class: 'grid g2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h2', {}, 'Most attempted (last 300 attempts)'), topList.length ? topList.map(([t, c]) => h('div', { class: 'row between', style: { padding: '6px 0' } }, h('span', { style: { overflowWrap: 'anywhere' } }, t), h('span', { class: 'chip' }, c))) : empty('No attempts yet')),
      h('div', { class: 'card' }, h('h2', {}, 'Recent activity'), logs.docs.length ? logs.docs.map((d) => { const l = d.data(); return h('div', { class: 'small', style: { padding: '5px 0' } }, h('strong', {}, USER_META[l.actorUserId]?.name || l.actorUserId), ' · ', l.action.replaceAll('_', ' '), h('span', { class: 'muted' }, ' · ' + tsDate(l.timestamp))); }) : empty('No activity yet'))));
}

// ===================== EXAM MANAGEMENT =====================
async function previewExam(id) {
  const { exam } = await S.adminGetExam({ examId: id });
  modal(h('div', { class: 'modal-body wide' }, h('h2', {}, 'Preview: ' + exam.title), examPreview(exam), h('div', { class: 'row end', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: (e) => e.target.closest('dialog').close() }, 'Close'))), 'Exam preview');
}
function examPreview(e) {
  return h('div', { class: 'stack' }, h('p', {}, e.description), h('div', { class: 'meta' }, h('span', { class: 'chip' }, e.category), h('span', { class: 'chip' }, `${e.durationMinutes} min`), h('span', { class: 'chip' }, `${e.maxAttempts} attempts`), h('span', { class: 'chip' }, `${e.questions.length} questions`)),
    e.questions.map((q, i) => h('div', { class: 'card flat' }, h('div', { class: 'small muted' }, `${i + 1}. ${q.difficulty} · ${q.points} pts · id ${q.id}`), h('p', { style: { fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, q.question),
      q.options.map((o, k) => h('div', { class: 'ropt' + (k === q.correctAnswer ? ' correct' : '') }, o, k === q.correctAnswer && h('span', { class: 'small muted' }, ' (correct)'))), q.explanation && h('p', { class: 'small muted' }, q.explanation))));
}
export async function exams(v) {
  const snap = await getDocs(query(collection(db, 'exams'), orderBy('updatedAt', 'desc'))); let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const q = h('input', { type: 'search', placeholder: 'Search title or subject', 'aria-label': 'Search' }), st = h('select', { 'aria-label': 'Status' }, ['all', 'draft', 'published', 'upcoming', 'closed'].map((x) => h('option', { value: x }, x === 'all' ? 'All statuses' : x))),
    df = h('select', { 'aria-label': 'Difficulty' }, ['all', 'easy', 'medium', 'hard', 'mixed'].map((x) => h('option', { value: x }, x === 'all' ? 'All difficulties' : x))), body = h('tbody');
  const act = (label, fnc, cls = '') => h('button', { class: 'btn sm ' + cls, onclick: (e) => busy(e.currentTarget, fnc) }, label);
  const reload = () => exams(v);
  function draw() {
    const t = q.value.toLowerCase(); const list = rows.filter((e) => (e.title + ' ' + e.category).toLowerCase().includes(t) && (df.value === 'all' || e.difficulty === df.value) &&
      (st.value === 'all' || (st.value === 'draft' ? e.publicationStatus === 'draft' : e.publicationStatus === 'published' && (st.value === 'published' || availability(e) === st.value))));
    body.replaceChildren(...(list.length ? list.map((e) => { const pub = e.publicationStatus === 'published';
      return h('tr', {}, td('Title', h('div', { class: 'title-cell' }, h('strong', {}, e.title))), td('Subject', e.category), td('Difficulty', h('span', { class: 'chip' }, e.difficulty)), td('Questions', e.questionCount), td('Duration', e.durationMinutes + ' min'), td('Attempt limit', e.maxAttempts),
        td('Status', h('span', { class: 'chip ' + (pub ? 'ok' : '') }, pub ? 'Published' : 'Draft')), td('Opens', h('span', { class: 'nowrap' }, e.openingAt ? tsDate(e.openingAt) : 'Immediately')), td('Closes', h('span', { class: 'nowrap' }, e.closingAt ? tsDate(e.closingAt) : 'Never')),
        td('Actions', h('div', { class: 'row', style: { gap: '6px' } }, act('Preview', () => previewExam(e.id)), h('a', { class: 'btn sm', href: '#/admin/exams/edit/' + e.id }, 'Edit'),
          act(pub ? 'Unpublish' : 'Publish', async () => { if (pub && !(await confirmDialog({ title: 'Unpublish examination?', message: 'Users will no longer see it. Finished attempts stay.', confirmText: 'Unpublish' }))) return; await S.adminSetStatus({ examId: e.id, status: pub ? 'draft' : 'published' }); toast(pub ? 'Unpublished' : 'Published'); reload(); }),
          act('Duplicate', async () => { await S.adminDuplicateExam({ examId: e.id }); toast('Duplicated as draft'); reload(); }),
          act('Delete', async () => { if (await confirmDialog({ title: 'Delete examination?', message: `"${e.title}" and its questions will be permanently deleted. This only works when it has no attempts.`, confirmText: 'Delete', danger: true })) { await S.adminDeleteExam({ examId: e.id }); toast('Deleted'); reload(); } }, 'danger'))));
    }) : [h('tr', {}, h('td', { colspan: 10 }, empty('No examinations match', 'Create one or import JSON.')))]));
  }
  [q, st, df].forEach((x) => x.addEventListener('input', draw)); draw();
  v.replaceChildren(head('Examinations', h('a', { class: 'btn', href: '#/admin/import' }, 'Import JSON'), h('a', { class: 'btn primary', href: '#/admin/exams/edit/new' }, 'Create examination')),
    h('div', { class: 'grid g4', style: { marginBottom: '12px' } }, q, st, df), h('div', { class: 'table-wrap' }, h('table', { class: 'stack-sm' }, th(['Title', 'Subject', 'Difficulty', 'Questions', 'Duration', 'Attempt limit', 'Status', 'Opens', 'Closes', 'Actions']), body)));
}

// ===================== EDITOR (create / edit / edit-after-import) =====================
const blank = () => ({ schemaVersion: 1, title: '', description: '', category: '', difficulty: 'mixed', instructions: '', tags: [], durationMinutes: 20, maxAttempts: 3, openingAt: null, closingAt: null, passingScore: null, shuffleQuestions: true, shuffleOptions: true, showExplanations: true, allowReview: true, showCorrectAnswers: true, questions: [] });
const newQ = (n) => ({ id: 'q' + n, question: '', options: ['', '', '', ''], correctAnswer: 0, difficulty: 'easy', points: 100, explanation: '', timeBudgetSeconds: null });
export async function editor(v, { id }) {
  let E, examId = id === 'new' ? null : id;
  if (!examId) { E = state.draft || blank(); state.draft = null; } else E = (await S.adminGetExam({ examId })).exam;
  const err = h('div', { role: 'alert' }), qBox = h('div', { class: 'stack' });
  const f = (label, key, o = {}) => { const i = h(o.area ? 'textarea' : 'input', { type: o.type || 'text', id: 'f-' + key, ...(o.area ? {} : { value: o.val ?? E[key] ?? '' }), min: o.min, max: o.max }); if (o.area) i.textContent = E[key] ?? '';
    i.addEventListener('input', () => { E[key] = o.set ? o.set(i.value) : o.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value; }); return h('div', { class: 'field' }, h('label', { for: 'f-' + key }, label), i); };
  const chk = (label, key) => { const i = h('input', { type: 'checkbox', id: 'c-' + key, checked: E[key] }); i.addEventListener('change', () => { E[key] = i.checked; }); return h('div', { class: 'check' }, i, h('label', { for: 'c-' + key }, label)); };
  const diff = h('select', { id: 'f-difficulty' }, ['mixed', 'easy', 'medium', 'hard'].map((x) => h('option', { value: x, selected: E.difficulty === x }, x))); diff.addEventListener('change', () => { E.difficulty = diff.value; });
  function drawQs() {
    qBox.replaceChildren(...E.questions.map((q, i) => {
      const bind = (el, set) => { el.addEventListener('input', () => set(el.value)); return el; };
      const ta = h('textarea', { 'aria-label': `Question ${i + 1} text` }); ta.textContent = q.question; bind(ta, (x) => { q.question = x; });
      const ex = h('textarea', { 'aria-label': 'Explanation' }); ex.textContent = q.explanation || ''; bind(ex, (x) => { q.explanation = x; });
      const dsel = h('select', { 'aria-label': 'Difficulty' }, ['easy', 'medium', 'hard'].map((x) => h('option', { value: x, selected: q.difficulty === x }, x))), pts = h('input', { type: 'number', min: 1, max: 1000, value: q.points, 'aria-label': 'Points' });
      dsel.addEventListener('change', () => { q.difficulty = dsel.value; q.points = DEFAULT_POINTS[q.difficulty]; pts.value = q.points; }); pts.addEventListener('input', () => { q.points = Number(pts.value); });
      return h('fieldset', { class: 'qedit', style: { border: '1px solid var(--line)' } }, h('legend', { class: 'small muted' }, `Question ${i + 1}`), h('div', { class: 'field' }, h('label', {}, 'Question'), ta),
        q.options.map((o, k) => h('div', { class: 'optrow' }, h('input', { type: 'radio', name: 'c' + i, checked: q.correctAnswer === k, 'aria-label': `Option ${k + 1} is correct`, onchange: () => { q.correctAnswer = k; } }), bind(h('input', { value: o, 'aria-label': `Option ${k + 1}`, placeholder: `Option ${k + 1}` }), (x) => { q.options[k] = x; }))),
        h('div', { class: 'grid g4' }, h('div', {}, h('label', {}, 'Difficulty'), dsel), h('div', {}, h('label', {}, 'Points'), pts), h('div', {}, h('label', {}, 'Question ID'), bind(h('input', { value: q.id }), (x) => { q.id = x; }))),
        h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', {}, 'Explanation (optional)'), ex), h('button', { class: 'btn sm danger', type: 'button', onclick: () => { E.questions.splice(i, 1); drawQs(); } }, 'Remove question'));
    }));
  }
  const open = h('input', { type: 'datetime-local', id: 'f-open', value: toInputDT(E.openingAt ? Date.parse(E.openingAt) : null) }), close = h('input', { type: 'datetime-local', id: 'f-close', value: toInputDT(E.closingAt ? Date.parse(E.closingAt) : null) });
  open.addEventListener('input', () => { const m = fromInputDT(open.value); E.openingAt = m ? new Date(m).toISOString() : null; }); close.addEventListener('input', () => { const m = fromInputDT(close.value); E.closingAt = m ? new Date(m).toISOString() : null; });
  const collect = () => { const r = validateExam({ ...E, tags: Array.isArray(E.tags) ? E.tags : [] }); err.replaceChildren(...(r.ok ? [] : [h('div', { class: 'alert' }, h('strong', {}, 'Fix these before saving:'), h('ul', {}, r.errors.map((x) => h('li', {}, x))))])); if (!r.ok) err.scrollIntoView({ block: 'center' }); return r; };
  const save = h('button', { class: 'btn primary', onclick: () => busy(save, async () => { const r = collect(); if (!r.ok) return; const res = await S.adminSaveExam({ examId, exam: r.exam }); examId = res.examId; toast('Saved'); navigate('/admin/exams'); }) }, 'Save examination');
  const prev = h('button', { class: 'btn', onclick: () => { const r = collect(); if (r.ok) modal(h('div', { class: 'modal-body wide' }, h('h2', {}, 'Preview'), examPreview(r.exam), h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: (e) => e.target.closest('dialog').close() }, 'Close'))), 'Preview'); } }, 'Preview');
  drawQs();
  v.replaceChildren(head(examId ? 'Edit examination' : 'Create examination', prev, save), h('p', { class: 'small muted' }, 'Dates use Asia/Amman time. New examinations are saved as drafts; publish them from the list.'),
    h('section', { class: 'card stack' }, f('Title', 'title'), f('Description', 'description', { area: true }), h('div', { class: 'grid g4' }, f('Subject / category', 'category'), h('div', { class: 'field' }, h('label', { for: 'f-difficulty' }, 'Difficulty'), diff), f('Duration (minutes)', 'durationMinutes', { type: 'number', min: 1, max: 600 }), f('Max attempts', 'maxAttempts', { type: 'number', min: 1, max: 100 })),
      h('div', { class: 'grid g2' }, h('div', { class: 'field' }, h('label', { for: 'f-open' }, 'Opens (blank = immediately)'), open), h('div', { class: 'field' }, h('label', { for: 'f-close' }, 'Closes (blank = never)'), close)),
      f('Instructions (optional)', 'instructions', { area: true }), h('div', { class: 'grid g2' }, f('Tags (comma separated)', 'tags', { val: (E.tags || []).join(', '), set: (x) => x.split(',').map((t) => t.trim()).filter(Boolean) }), f('Passing score, % accuracy (optional)', 'passingScore', { type: 'number', min: 1, max: 100 })),
      h('div', { class: 'grid g2' }, chk('Shuffle questions', 'shuffleQuestions'), chk('Shuffle answer options', 'shuffleOptions'), chk('Show explanations after submission', 'showExplanations'), chk('Allow reviewing answers', 'allowReview'), chk('Show correct answers after completion', 'showCorrectAnswers'))),
    h('h2', { style: { margin: '24px 0 12px' } }, 'Questions'), qBox, h('div', { class: 'row', style: { margin: '16px 0' } }, h('button', { class: 'btn', onclick: () => { let n = E.questions.length + 1; while (E.questions.some((q) => q.id === 'q' + n)) n++; E.questions.push(newQ(n)); drawQs(); } }, 'Add question')), err, h('div', { class: 'row end' }, save));
}

// ===================== JSON IMPORT =====================
const EXAMPLE = { schemaVersion: 1, title: 'Python Fundamentals', description: 'A multiple-choice Python examination.', category: 'Programming', difficulty: 'mixed', durationMinutes: 20, maxAttempts: 3, openingAt: null, closingAt: null, shuffleQuestions: true, shuffleOptions: true, showExplanations: true,
  questions: [{ id: 'q1', question: 'What is the output of print(2 + 3)?', options: ['4', '5', '6', '7'], correctAnswer: 1, difficulty: 'easy', points: 100, explanation: 'The expression 2 + 3 evaluates to 5.' }] };
const PROMPT = `Create a multiple-choice examination about: [TOPIC], [NUMBER] questions, mixed difficulty (easy/medium/hard).
Return ONLY one JSON object (no markdown, no commentary) that follows exactly this schema:
${JSON.stringify(EXAMPLE, null, 2)}
Rules:
- schemaVersion must be 1.
- Every question has a unique "id" (letters, digits, "_" or "-"), exactly 4 different options and exactly one correct answer.
- "correctAnswer" is the ZERO-BASED index (0-3) of the correct option.
- "difficulty" per question is "easy", "medium" or "hard"; "points" is 100 for easy, 200 for medium, 300 for hard.
- openingAt/closingAt: null, or an ISO date-time with a timezone such as "2026-12-01T09:00:00+03:00".
- Keep every question and option plain text (no HTML or markdown). Give a short "explanation" for each question.`;
export function importer(v) {
  const ta = h('textarea', { rows: 12, 'aria-label': 'Examination JSON', placeholder: 'Paste the JSON from ChatGPT here', spellcheck: 'false' }), out = h('div', { class: 'stack' });
  const check = h('button', { class: 'btn primary', onclick: () => {
    const r = parseExamJson(ta.value);
    if (!r.ok) { out.replaceChildren(h('div', { class: 'alert' }, h('strong', {}, `${r.errors.length} problem${r.errors.length > 1 ? 's' : ''} found. Nothing was imported.`), h('ul', {}, r.errors.map((x) => h('li', {}, x))))); return; }
    const imp = h('button', { class: 'btn primary', onclick: () => busy(imp, async () => { await S.adminSaveExam({ exam: r.exam, source: 'import' }); toast('Imported as draft'); navigate('/admin/exams'); }) }, 'Import as draft');
    out.replaceChildren(h('div', { class: 'alert info' }, `Valid: ${r.exam.questions.length} questions. Review the correct answers below, then import.`), h('div', { class: 'card' }, h('h2', {}, r.exam.title), examPreview(r.exam)),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => { state.draft = r.exam; navigate('/admin/exams/edit/new'); } }, 'Edit questions first'), imp));
  } }, 'Validate and preview');
  v.replaceChildren(head('Import examination (JSON)'), h('div', { class: 'grid g2' },
    h('section', { class: 'card stack' }, h('h2', {}, '1. Generate with ChatGPT'), h('p', { class: 'small muted' }, 'This site never talks to ChatGPT. Copy the prompt, run it in ChatGPT yourself, then paste the JSON it returns.'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copyText(PROMPT) }, 'Copy prompt'), h('button', { class: 'btn', onclick: () => copyText(JSON.stringify(EXAMPLE, null, 2)) }, 'Copy example JSON'), h('button', { class: 'btn', onclick: () => download('quizverse-example.json', JSON.stringify(EXAMPLE, null, 2)) }, 'Download example')), h('pre', { class: 'code' }, JSON.stringify(EXAMPLE, null, 2))),
    h('section', { class: 'card stack' }, h('h2', {}, '2. Paste and validate'), ta, check)), h('div', { style: { marginTop: '16px' } }, out));
}

// ===================== USERS / ATTEMPTS =====================
export async function users(v) {
  const [sums, snap] = await Promise.all([loadSummaries(), getDocs(collection(db, 'users'))]);
  const S = Object.fromEntries(sums.map((s) => [s.userId, s])), U = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
  v.replaceChildren(head('Users'), h('div', { class: 'table-wrap' }, h('table', { class: 'stack-sm' }, th(['Name', 'Role', 'Attempts', 'Completed', 'Total points', 'Avg accuracy', 'Avg time', 'Last activity', '']),
    h('tbody', {}, Object.entries(USER_META).map(([id, m]) => { const s = S[id] || {}, u = U[id];
      return h('tr', {}, td('Name', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, avatar(id, m.name, 32), h('strong', {}, m.name), !u && h('span', { class: 'chip warn' }, 'Never signed in'))), td('Role', h('span', { class: 'chip ' + (m.role === 'admin' ? 'acc' : '') }, m.role)), td('Attempts', fmtN(s.attemptsStarted)), td('Completed', fmtN(s.completedAttempts)),
        td('Points', fmtN(s.totalPoints)), td('Avg accuracy', s.completedAttempts ? fmtPct(s.averageAccuracy) : '—'), td('Avg time', s.completedAttempts ? fmtDur(s.totalCompletionSeconds / s.completedAttempts) : '—'), td('Last activity', h('span', { class: 'nowrap' }, u?.lastActivityAt ? tsDate(u.lastActivityAt) : '—')),
        td('', h('a', { class: 'btn sm', href: '#/admin/attempts' }, 'Attempts'))); })))));
}
export async function attempts(v) {
  await S.adminFinalizeAllExpired(); let cursor = null; const body = h('tbody'), more = h('button', { class: 'btn', onclick: () => load(false) }, 'Load more');
  const uSel = h('select', { 'aria-label': 'User' }, h('option', { value: '' }, 'All users'), Object.entries(USER_META).map(([id, m]) => h('option', { value: id }, m.name)));
  const sSel = h('select', { 'aria-label': 'Status' }, h('option', { value: '' }, 'All statuses'), Object.entries(STATUS_LABEL).map(([k, t]) => h('option', { value: k }, t)));
  async function load(reset) {
    if (reset) { cursor = null; body.replaceChildren(); } more.disabled = true;
    try { const r = await loadAttempts(uSel.value || null, { size: 20, after: cursor, status: sSel.value || null }); cursor = r.last;
      r.rows.forEach((a) => body.append(h('tr', {}, td('User', USER_META[a.userId]?.name), td('Examination', h('div', { class: 'title-cell' }, a.examTitle)), td('Attempt', '#' + a.attemptNumber), td('Started', h('span', { class: 'nowrap' }, tsDate(a.startedAt))), td('Status', h('span', { class: 'chip ' + statusClass(a.status) }, STATUS_LABEL[a.status])),
        td('Score', (a.status === 'in_progress' || a.pending) ? '—' : fmtN(a.totalPoints)), td('Accuracy', (a.status === 'in_progress' || a.pending) ? '—' : fmtPct(a.accuracy)), td('', a.status === 'in_progress' ? '' : h('a', { class: 'btn sm', href: '#/results/' + a.id }, 'Details')))));
      if (reset && !r.rows.length) body.append(h('tr', {}, h('td', { colspan: 8 }, empty('No attempts match')))); more.hidden = !r.more; } catch (e) { toast(e.message, true); } more.disabled = false;
  }
  [uSel, sSel].forEach((x) => x.addEventListener('change', () => load(true)));
  v.replaceChildren(head('All attempts'), h('div', { class: 'grid g4', style: { marginBottom: '12px' } }, uSel, sSel), h('div', { class: 'table-wrap' }, h('table', { class: 'stack-sm' }, th(['User', 'Examination', 'Attempt', 'Started', 'Status', 'Score', 'Accuracy', '']), body)), h('div', { class: 'center' }, more)); await load(true);
}

// ===================== ACTIVITY LOGS =====================
const ACTIONS = ['login_success', 'exam_started', 'exam_completed', 'exam_timed_out', 'exam_created', 'exam_imported', 'exam_edited', 'exam_published', 'exam_unpublished', 'exam_duplicated', 'exam_deleted'];
export async function logs(v) {
  const exSnap = await getDocs(query(collection(db, 'exams'), orderBy('updatedAt', 'desc')));
  const uSel = h('select', { 'aria-label': 'User' }, h('option', { value: '' }, 'All users'), Object.entries(USER_META).map(([id, m]) => h('option', { value: id }, m.name)));
  const aSel = h('select', { 'aria-label': 'Action' }, h('option', { value: '' }, 'All actions'), ACTIONS.map((a) => h('option', { value: a }, a.replaceAll('_', ' '))));
  const eSel = h('select', { 'aria-label': 'Examination' }, h('option', { value: '' }, 'All examinations'), exSnap.docs.map((d) => h('option', { value: d.id }, d.data().title)));
  const from = h('input', { type: 'date', 'aria-label': 'From date' }), to = h('input', { type: 'date', 'aria-label': 'To date' }), body = h('tbody'), more = h('button', { class: 'btn', onclick: () => load(false) }, 'Load more'); let cursor = null;
  const { Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  async function load(reset) {
    if (reset) { cursor = null; body.replaceChildren(); } more.disabled = true;
    const c = []; if (uSel.value) c.push(where('actorUserId', '==', uSel.value)); if (aSel.value) c.push(where('action', '==', aSel.value)); if (eSel.value) c.push(where('examId', '==', eSel.value));
    if (from.value) c.push(where('timestamp', '>=', Timestamp.fromMillis(fromInputDT(from.value + 'T00:00')))); if (to.value) c.push(where('timestamp', '<', Timestamp.fromMillis(fromInputDT(to.value + 'T00:00') + 86400000)));
    c.push(orderBy('timestamp', 'desc')); if (cursor) c.push(startAfter(cursor)); c.push(limit(25));
    try { const s = await getDocs(query(collection(db, 'activityLogs'), ...c)); cursor = s.docs[s.docs.length - 1] || cursor;
      s.docs.forEach((d) => { const l = d.data(); body.append(h('tr', {}, td('Time', h('span', { class: 'nowrap' }, tsDate(l.timestamp))), td('User', USER_META[l.actorUserId]?.name || l.actorUserId), td('Action', h('span', { class: 'chip' }, l.action.replaceAll('_', ' '))), td('Exam', h('div', { class: 'title-cell small' }, l.metadata?.title || l.examId || '—')), td('Attempt', h('span', { class: 'small muted' }, l.attemptId || '—')), td('Metadata', h('code', { class: 'small' }, JSON.stringify(l.metadata || {}))))); });
      if (reset && !s.docs.length) body.append(h('tr', {}, h('td', { colspan: 6 }, empty('No log entries match')))); more.hidden = s.docs.length < 25; } catch (e) { toast(e.message, true); } more.disabled = false;
  }
  [uSel, aSel, eSel, from, to].forEach((x) => x.addEventListener('change', () => load(true)));
  v.replaceChildren(head('Activity logs'), h('div', { class: 'grid g4', style: { marginBottom: '12px' } }, uSel, aSel, eSel, h('div', {}, from), h('div', {}, to)), h('div', { class: 'table-wrap' }, h('table', { class: 'stack-sm' }, th(['Time', 'User', 'Action', 'Examination', 'Attempt', 'Metadata']), body)), h('div', { class: 'center' }, more)); await load(true);
}
