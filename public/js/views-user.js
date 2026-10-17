import { db, doc, getDoc } from './api.js';
import { startAttempt, getAttempt, saveAnswer, recordView, finalizeAttempt, getResult } from './services.js';
import { state, navigate, onCleanup } from './state.js';
import { h, icon, avatar, chart, empty, loading, confirmDialog, toast, fmtDate, fmtShort, fmtN, fmtPct, fmtDur, startOfPeriod } from './ui.js';
import { ms, USER_META, COMPLETED, STATUS_LABEL, statusClass, loadSummaries, loadSummariesSince, loadBoardData, sortBoard, loadExams, loadAttempts, availability } from './data.js';

const stat = (label, value, sub) => h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label), sub && h('div', { class: 'small muted' }, sub));
const head = (title, ...right) => h('div', { class: 'row between', style: { marginBottom: '16px' } }, h('h1', { style: { margin: 0 } }, title), h('div', { class: 'row' }, ...right));
const done = (rows) => rows.filter((a) => COMPLETED.includes(a.status) && !a.pending);

function examCard(e, used) {
  const av = availability(e), left = Math.max(0, e.maxAttempts - used), can = av === 'open' && left > 0;
  return h('article', { class: 'card exam-card' },
    h('div', { class: 'row between' }, h('span', { class: 'chip acc' }, e.category), h('span', { class: 'chip ' + (av === 'open' ? 'ok' : av === 'upcoming' ? 'warn' : 'bad') }, av === 'open' ? 'Open' : av === 'upcoming' ? 'Upcoming' : 'Closed')),
    h('h3', {}, e.title), h('p', { class: 'muted', style: { margin: 0 } }, e.description),
    h('div', { class: 'meta small muted' }, h('span', {}, `${e.questionCount} questions`), h('span', {}, `${e.durationMinutes} min`), h('span', {}, `${left} of ${e.maxAttempts} attempts left`)),
    h('div', { class: 'small muted' }, av === 'upcoming' ? `Opens ${fmtDate(ms(e.openingAt))}` : e.closingAt ? `Closes ${fmtDate(ms(e.closingAt))}` : 'No closing date'),
    h('a', { class: 'btn ' + (can ? 'primary' : ''), href: can ? '#/exam/' + e.id : null, 'aria-disabled': can ? null : 'true', style: can ? {} : { pointerEvents: 'none', opacity: .55 } }, can ? 'Open examination' : av === 'open' ? 'No attempts left' : 'Not available'));
}

export async function dashboard(v) {
  const uid = state.user.id;
  const [sums, att, exams] = await Promise.all([loadSummaries(), loadAttempts(uid, { size: 100 }), loadExams()]);
  const mine = sums.find((s) => s.userId === uid) || {}, rank = sortBoard(sums).findIndex((s) => s.userId === uid) + 1;
  const fin = done(att.rows).reverse(), avgScore = fin.length ? fin.reduce((t, a) => t + a.totalPoints, 0) / fin.length : 0;
  const used = (id) => att.rows.filter((a) => a.examId === id).length;
  const open = exams.filter((e) => availability(e) === 'open'), up = exams.filter((e) => availability(e) === 'upcoming');
  v.replaceChildren(head(`Hello, ${state.user.name}`),
    h('div', { class: 'grid g4' }, stat('Total points', fmtN(mine.totalPoints)), stat('Leaderboard rank', rank ? '#' + rank : '—'), stat('Completed exams', fmtN(mine.completedAttempts)), stat('Total attempts', fmtN(mine.attemptsStarted ?? att.rows.length)),
      stat('Average accuracy', fmtPct(mine.averageAccuracy)), stat('Best score', fmtN(mine.bestScore)), stat('Average score', fmtN(avgScore)), stat('Time in exams', fmtDur(mine.totalCompletionSeconds))),
    h('div', { class: 'grid g2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, chart(fin.map((a) => ({ x: fmtShort(ms(a.startedAt)), y: a.totalPoints })), { title: 'Score progression', bar: false })),
      h('div', { class: 'card' }, chart(fin.map((a) => ({ x: fmtShort(ms(a.startedAt)), y: a.accuracy })), { title: 'Accuracy progression (%)', unit: '%' })),
      h('div', { class: 'card' }, chart(fin.map((a) => ({ x: fmtShort(ms(a.startedAt)), y: a.totalPoints })), { title: 'Points earned per exam', bar: true })),
      h('div', { class: 'card' }, h('h2', {}, 'Recent results'), att.rows.length ? h('div', { class: 'stack' }, att.rows.slice(0, 5).map((a) => h('div', { class: 'row between' }, h('div', {}, h('a', { href: a.status === 'in_progress' ? '#/exam/' + a.examId : '#/results/' + a.id }, a.examTitle), h('div', { class: 'small muted' }, `Attempt ${a.attemptNumber} · ${fmtDate(ms(a.startedAt))}`)),
        h('span', { class: 'chip ' + statusClass(a.status) }, a.status === 'in_progress' ? 'In progress' : a.pending ? 'Score pending' : `${fmtN(a.totalPoints)} pts`)))) : empty('No attempts yet', 'Start your first examination below.'))),
    h('h2', { style: { margin: '24px 0 12px' } }, 'Available examinations'), open.length ? h('div', { class: 'grid g2' }, open.map((e) => examCard(e, used(e.id)))) : empty('Nothing open right now', 'Check back soon.'),
    up.length ? [h('h2', { style: { margin: '24px 0 12px' } }, 'Upcoming'), h('div', { class: 'grid g2' }, up.map((e) => examCard(e, used(e.id))))] : null);
}

export async function exams(v) {
  const [list, att] = await Promise.all([loadExams(), loadAttempts(state.user.id, { size: 100 })]);
  const used = (id) => att.rows.filter((a) => a.examId === id).length, rank = { open: 0, upcoming: 1, closed: 2 };
  const search = h('input', { type: 'search', placeholder: 'Search examinations', 'aria-label': 'Search examinations' }), grid = h('div', { class: 'grid g2' });
  const draw = () => { const q = search.value.toLowerCase(); const rows = list.filter((e) => (e.title + e.category).toLowerCase().includes(q)).sort((a, b) => rank[availability(a)] - rank[availability(b)]); grid.replaceChildren(...(rows.length ? rows.map((e) => examCard(e, used(e.id))) : [empty('No examinations found')])); };
  search.addEventListener('input', draw); draw();
  v.replaceChildren(head('Examinations'), h('div', { class: 'field' }, search), grid);
}

// ===================== EXAM RUNNER =====================
export async function runner(v, { id }) {
  const snap = await getDoc(doc(db, 'exams', id)), e = snap.data();
  if (!e || e.publicationStatus !== 'published') { v.replaceChildren(h('div', { class: 'card stack' }, h('h2', {}, 'Examination not available'), h('a', { class: 'btn', href: '#/exams' }, 'Back to examinations'))); return; }
  const err = h('div', { class: 'err', role: 'alert' });
  const start = h('button', { class: 'btn primary', onclick: async () => {
    start.disabled = true; err.textContent = '';
    try { const { attemptId } = await startAttempt(id); const data = await getAttempt(attemptId); if (data.status !== 'in_progress') return navigate('/results/' + attemptId); run(v, data); }
    catch (x) { err.textContent = x.message; start.disabled = false; }
  } }, 'Start / resume');
  v.replaceChildren(h('section', { class: 'card stack runner' }, h('a', { href: '#/exams', class: 'small' }, 'Back'), h('h1', {}, e.title), h('p', {}, e.description),
    h('div', { class: 'meta' }, h('span', { class: 'chip' }, `${e.questionCount} questions`), h('span', { class: 'chip' }, `${e.durationMinutes} minutes`), h('span', { class: 'chip' }, `${e.maxAttempts} attempts max`)),
    e.instructions && h('p', { class: 'card flat', style: { whiteSpace: 'pre-wrap' } }, e.instructions),
    h('p', { class: 'small muted' }, 'The timer starts when you press Start and keeps running if you close the page. If you already have an attempt in progress, you will resume it. Faster correct answers earn a speed bonus of up to 25%.'), start, err));
}

function run(v, data) {
  const Q = data.questions, S = { idx: 0, answers: { ...data.answers }, pending: new Map(), viewed: new Set(data.viewed || []), offset: data.serverNow - Date.now(), finishing: false, flushing: false };
  const flagKey = 'flags:' + data.id;
  const flags = new Set((() => { try { return JSON.parse(sessionStorage.getItem(flagKey) || '[]'); } catch { return []; } })());
  const saveFlags = () => { try { sessionStorage.setItem(flagKey, JSON.stringify([...flags])); } catch { /* ignore */ } };
  const remaining = () => data.deadlineAt - (Date.now() + S.offset);
  const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Time remaining' }), saveEl = h('span', { class: 'small muted', 'aria-live': 'polite' }, '');
  const bar = h('i', {}), qArea = h('div', { class: 'stack' }), nav = h('div', { class: 'qnav', role: 'group', 'aria-label': 'Question navigator' });
  const sleep = (t) => new Promise((r) => setTimeout(r, t));
  const tick = () => { const r = Math.max(0, remaining()), s = Math.ceil(r / 1000); timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; timer.classList.toggle('warn', s <= 60); if (r <= 0) finish(true); };
  const iv = setInterval(tick, 500); onCleanup(() => { clearInterval(iv); document.removeEventListener('keydown', onKey); });

  async function flush() {
    if (S.flushing) return; S.flushing = true;
    try {
      while (S.pending.size) {
        const [qid, sel] = S.pending.entries().next().value;
        try { await saveAnswer(data.id, qid, sel === null ? null : data.perm[qid][sel]); if (S.pending.get(qid) === sel) S.pending.delete(qid); saveEl.textContent = 'Saved'; }
        catch (x) { if (x.code === 'permission-denied' && remaining() <= 3000) { S.pending.clear(); finish(true); return; } saveEl.textContent = x.code === 'permission-denied' ? 'Could not save this answer' : 'Offline: retrying…'; await sleep(2000); }
      }
    } finally { S.flushing = false; }
  }
  async function finish(timeUp) {
    if (S.finishing) return; S.finishing = true; clearInterval(iv);
    try {
      if (!timeUp) for (let i = 0; i < 15 && (S.pending.size || S.flushing); i++) await sleep(400);
      let res; for (let t = 0; ; t++) { try { res = await finalizeAttempt(data.id, S.offset); break; } catch (x) { if (t >= 3) throw x; await sleep(1500); } }
      if (timeUp) toast('Time is up. Your attempt was submitted.');
      navigate('/results/' + data.id);
    } catch (x) { S.finishing = false; toast(x.message + ' Press Submit to try again.', true); }
  }
  function select(i) { const q = Q[S.idx]; const val = S.answers[q.id] === i ? null : i; if (val === null) delete S.answers[q.id]; else S.answers[q.id] = i; saveEl.textContent = 'Saving…'; S.pending.set(q.id, val); flush(); draw(); }
  function go(n) { S.idx = Math.min(Q.length - 1, Math.max(0, n)); draw(); window.scrollTo({ top: 0 }); }
  function onKey(ev) { if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(ev.target.tagName)) return; if (/^[1-4]$/.test(ev.key)) select(+ev.key - 1); else if (ev.key === 'ArrowRight') go(S.idx + 1); else if (ev.key === 'ArrowLeft') go(S.idx - 1); }
  document.addEventListener('keydown', onKey);
  async function submit() {
    const un = Q.filter((q) => S.answers[q.id] == null).length;
    if (await confirmDialog({ title: 'Submit examination?', message: un ? `You have ${un} unanswered question${un > 1 ? 's' : ''}. Unanswered questions score zero. You cannot change answers after submitting.` : 'You cannot change your answers after submitting.', confirmText: 'Submit' })) finish(false);
  }
  function draw() {
    const q = Q[S.idx];
    if (!S.viewed.has(q.id)) { S.viewed.add(q.id); recordView(data.id, q.id); }
    const n = Object.keys(S.answers).length; bar.style.width = `${(n / Q.length) * 100}%`;
    qArea.replaceChildren(h('div', { class: 'row between small muted' }, h('span', {}, `Question ${S.idx + 1} of ${Q.length}`), h('span', {}, `${q.points} base points`)),
      h('div', { class: 'qtext', id: 'qt' }, q.question),
      h('div', { class: 'opts', role: 'radiogroup', 'aria-labelledby': 'qt' }, q.options.map((o, i) => h('button', { class: 'opt', role: 'radio', 'aria-checked': String(S.answers[q.id] === i), onclick: () => select(i) }, h('kbd', {}, i + 1), h('span', {}, o)))),
      h('button', { class: 'btn sm', 'aria-pressed': String(flags.has(q.id)), onclick: () => { flags.has(q.id) ? flags.delete(q.id) : flags.add(q.id); saveFlags(); draw(); } }, icon('flag'), flags.has(q.id) ? 'Flagged for review' : 'Flag for review'));
    nav.replaceChildren(...Q.map((x, i) => h('button', { class: [S.answers[x.id] != null ? 'done' : '', i === S.idx ? 'cur' : '', flags.has(x.id) ? 'flag' : ''].join(' '), 'aria-label': `Question ${i + 1}, ${S.answers[x.id] != null ? 'answered' : 'unanswered'}${flags.has(x.id) ? ', flagged' : ''}`, 'aria-current': i === S.idx ? 'true' : null, onclick: () => go(i) }, i + 1)));
    prev.disabled = S.idx === 0; next.disabled = S.idx === Q.length - 1;
  }
  const prev = h('button', { class: 'btn', onclick: () => go(S.idx - 1) }, icon('back'), 'Previous'), next = h('button', { class: 'btn', onclick: () => go(S.idx + 1) }, 'Next');
  v.replaceChildren(h('div', { class: 'runner' },
    h('div', { class: 'run-head' }, h('div', { class: 'row between' }, h('strong', { style: { overflowWrap: 'anywhere' } }, data.examTitle), timer), h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Answered questions' }, bar)),
    h('div', { class: 'card' }, qArea), h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('strong', {}, 'Questions'), saveEl), nav),
    h('div', { class: 'run-foot' }, h('div', { class: 'row' }, prev, next), h('button', { class: 'btn primary', onclick: submit }, 'Submit examination'))));
  tick(); draw();
}

// ===================== RESULTS =====================
export async function results(v, { id }) {
  const { attempt: a, review, pending } = await getResult(id);
  if (pending) {
    v.replaceChildren(head('Results', h('a', { class: 'btn', href: '#/history' }, 'History'), h('a', { class: 'btn primary', href: '#/exams' }, 'More examinations')),
      h('section', { class: 'card stack' }, h('h2', { style: { margin: 0, overflowWrap: 'anywhere' } }, a.examTitle), h('span', { class: 'small muted' }, `Attempt ${a.attemptNumber} · ${USER_META[a.userId]?.name} · ${fmtDate(ms(a.startedAt))}`),
        h('div', { class: 'row' }, h('span', { class: 'chip ' + statusClass(a.status) }, STATUS_LABEL[a.status])),
        h('div', { class: 'grid g4' }, stat('Questions answered', a.answeredCount ?? '—', `of ${a.questionCount}`), stat('Time spent', fmtDur(a.elapsedSeconds))),
        h('p', { class: 'alert info' }, 'Your answers are saved. Scores, correct answers and explanations are released once you have used all of your attempts for this examination or it has closed, so the key cannot help a later attempt.')));
    return;
  }
  const board = sortBoard(await loadSummaries()), pos = board.findIndex((s) => s.userId === a.userId) + 1;
  const passed = a.passingScore != null ? a.accuracy >= a.passingScore : null;
  v.replaceChildren(head('Results', h('a', { class: 'btn', href: '#/history' }, 'History'), h('a', { class: 'btn primary', href: '#/exams' }, 'More examinations')),
    h('section', { class: 'card stack' }, h('div', { class: 'row between' }, h('div', {}, h('h2', { style: { margin: 0, overflowWrap: 'anywhere' } }, a.examTitle), h('span', { class: 'small muted' }, `Attempt ${a.attemptNumber} · ${USER_META[a.userId]?.name} · ${fmtDate(ms(a.startedAt))}`)),
      h('div', { class: 'row' }, h('span', { class: 'chip ' + statusClass(a.status) }, STATUS_LABEL[a.status]), passed != null && h('span', { class: 'chip ' + (passed ? 'ok' : 'bad') }, passed ? `Passed (${a.passingScore}% needed)` : `Not passed (${a.passingScore}% needed)`))),
      h('div', { class: 'grid g4' }, stat('Final score', fmtN(a.totalPoints), `of ${fmtN(a.maxBasePoints)} base + bonus`), stat('Base points', fmtN(a.basePoints)), stat('Speed bonus', '+' + fmtN(a.speedBonus)), stat('Accuracy', fmtPct(a.accuracy)),
        stat('Correct', a.correctCount), stat('Incorrect', a.incorrectCount), stat('Unanswered', a.unansweredCount), stat('Time spent', fmtDur(a.elapsedSeconds)), stat('Leaderboard position', pos ? '#' + pos : '—'))),
    h('h2', { style: { margin: '24px 0 12px' } }, 'Review'),
    review ? h('div', { class: 'stack' }, review.map((r, i) => h('article', { class: 'card review-item ' + (r.isCorrect ? 'ok' : 'bad') },
      h('div', { class: 'row between small muted' }, h('span', {}, `Question ${i + 1}`), h('span', {}, `${r.score} pts${r.bonus ? ` (incl. +${r.bonus} speed)` : ''}`)), h('p', { style: { fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, r.question),
      r.options.map((o, k) => h('div', { class: 'ropt ' + (r.correct === k ? 'correct' : r.selected === k ? 'wrong' : '') }, o, r.selected === k && h('span', { class: 'small muted' }, ' (your answer)'), r.correct === k && h('span', { class: 'small muted' }, ' (correct)'))),
      r.selected == null && h('p', { class: 'small muted' }, 'Not answered.'), r.explanation && h('p', { class: 'card flat', style: { marginTop: '8px', whiteSpace: 'pre-wrap' } }, r.explanation)))) : empty('Review is disabled for this examination'));
}

// ===================== HISTORY =====================
export async function history(v) {
  const uid = state.user.id; let cursor = null;
  const body = h('tbody'), more = h('button', { class: 'btn', onclick: () => load() }, 'Load more'), cmp = h('div'), rows = [];
  async function load() {
    more.disabled = true; const r = await loadAttempts(uid, { size: 15, after: cursor }); cursor = r.last; rows.push(...r.rows);
    for (const a of r.rows) body.append(h('tr', {}, h('td', { 'data-label': 'Examination', class: 'title-cell' }, a.examTitle), h('td', { 'data-label': 'Attempt' }, '#' + a.attemptNumber), h('td', { 'data-label': 'Started', class: 'nowrap' }, fmtDate(ms(a.startedAt))), h('td', { 'data-label': 'Duration' }, fmtDur(a.elapsedSeconds)),
      h('td', { 'data-label': 'Correct / wrong / blank' }, (a.status === 'in_progress' || a.pending) ? '—' : `${a.correctCount} / ${a.incorrectCount} / ${a.unansweredCount}`), h('td', { 'data-label': 'Accuracy' }, (a.status === 'in_progress' || a.pending) ? '—' : fmtPct(a.accuracy)),
      h('td', { 'data-label': 'Base + bonus' }, (a.status === 'in_progress' || a.pending) ? '—' : `${fmtN(a.basePoints)} + ${fmtN(a.speedBonus)}`), h('td', { 'data-label': 'Score' }, h('strong', {}, (a.status === 'in_progress' || a.pending) ? '—' : fmtN(a.totalPoints))),
      h('td', { 'data-label': 'Status' }, h('span', { class: 'chip ' + statusClass(a.status) }, STATUS_LABEL[a.status])), h('td', {}, h('a', { class: 'btn sm', href: a.status === 'in_progress' ? '#/exam/' + a.examId : '#/results/' + a.id }, a.status === 'in_progress' ? 'Resume' : 'Details'))));
    more.hidden = !r.more; more.disabled = false;
    const f = done(rows); // newest first
    cmp.replaceChildren(...(f.length ? [h('div', { class: 'grid g4' }, stat('Latest score', fmtN(f[0].totalPoints), f[1] ? `${f[0].totalPoints - f[1].totalPoints >= 0 ? '+' : ''}${fmtN(f[0].totalPoints - f[1].totalPoints)} vs previous` : 'First result'),
      stat('Best score', fmtN(Math.max(...f.map((a) => a.totalPoints)))), stat('Average score', fmtN(f.reduce((t, a) => t + a.totalPoints, 0) / f.length)), stat('Latest accuracy', fmtPct(f[0].accuracy), f[1] ? `previous ${fmtPct(f[1].accuracy)}` : ''))] : []));
  }
  v.replaceChildren(head('Examination history'), cmp, h('div', { class: 'table-wrap', style: { marginTop: '16px' } }, h('table', { class: 'stack-sm' }, h('thead', {}, h('tr', {}, ['Examination', 'Attempt', 'Started', 'Duration', 'Correct / wrong / blank', 'Accuracy', 'Base + bonus', 'Score', 'Status', ''].map((t) => h('th', {}, t)))), body)), h('div', { class: 'center' }, more));
  await load(); if (!rows.length) { v.replaceChildren(head('Examination history'), empty('No attempts yet', 'Your results will appear here after your first examination.')); }
}

// ===================== LEADERBOARD =====================
async function aggregate(period) { return period === 'all' ? loadSummaries() : loadSummariesSince(startOfPeriod(period)); }
export async function leaderboard(v) {
  let period = 'all'; const table = h('div'), seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Period' });
  async function draw() {
    seg.replaceChildren(...[['all', 'All time'], ['month', 'This month'], ['week', 'This week']].map(([k, t]) => h('button', { 'aria-pressed': String(period === k), onclick: () => { period = k; draw(); } }, t)));
    table.replaceChildren(loading());
    const agg = await aggregate(period), byId = Object.fromEntries(agg.map((s) => [s.userId, s]));
    const rows = sortBoard(Object.keys(USER_META).map((id) => byId[id] || { userId: id }));
    table.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'stack-sm' }, h('thead', {}, h('tr', {}, ['Rank', 'User', 'Points', 'Completed', 'Avg accuracy', 'Best score', 'Avg time'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows.map((s, i) => h('tr', { class: s.userId === state.user.id ? 'me-row' : '' }, h('td', { 'data-label': 'Rank' }, h('span', { class: 'rank r' + (i + 1) }, i + 1)),
        h('td', { 'data-label': 'User' }, h('a', { href: '#/user/' + s.userId, class: 'row', style: { textDecoration: 'none', color: 'inherit', flexWrap: 'nowrap' } }, avatar(s.userId, USER_META[s.userId].name, 34), h('strong', {}, USER_META[s.userId].name))),
        h('td', { 'data-label': 'Points' }, h('strong', {}, fmtN(s.totalPoints))), h('td', { 'data-label': 'Completed' }, fmtN(s.completedAttempts)), h('td', { 'data-label': 'Avg accuracy' }, s.completedAttempts ? fmtPct(s.averageAccuracy) : '—'),
        h('td', { 'data-label': 'Best score' }, fmtN(s.bestScore)), h('td', { 'data-label': 'Avg time' }, s.completedAttempts ? fmtDur(s.totalCompletionSeconds / s.completedAttempts) : '—')))))),
      h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Ranked by total points from finalized attempts. Ties: higher average accuracy, then lower total completion time. Week starts Monday 00:00, month on the 1st, both in Asia/Amman time. Scores are recomputed from raw answers; attempts whose answer key has not been released to you yet are not counted.'));
  }
  v.replaceChildren(head('Leaderboard', seg), table); await draw();
}

// Public profile: only the data the app deliberately shares (summary + per-attempt points/accuracy).
export async function profile(v, { id }) {
  if (!USER_META[id]) return navigate('/leaderboard');
  const { summaries: sums, entries: all } = await loadBoardData();
  const s = sums.find((x) => x.userId === id) || {}, rank = sortBoard(sums).findIndex((x) => x.userId === id) + 1, e = all.filter((x) => x.userId === id);
  v.replaceChildren(head(USER_META[id].name, h('a', { class: 'btn', href: '#/leaderboard' }, 'Leaderboard')), h('div', { class: 'row', style: { marginBottom: '16px' } }, avatar(id, USER_META[id].name, 56), h('span', { class: 'chip' }, 'Shared statistics')),
    h('div', { class: 'grid g4' }, stat('Total points', fmtN(s.totalPoints)), stat('Rank', rank && s.totalPoints != null ? '#' + rank : '—'), stat('Completed exams', fmtN(s.completedAttempts)), stat('Total attempts', fmtN(s.attemptsStarted)), stat('Average accuracy', fmtPct(s.averageAccuracy)), stat('Best score', fmtN(s.bestScore))),
    h('div', { class: 'grid g2', style: { marginTop: '16px' } }, h('div', { class: 'card' }, chart(e.map((x) => ({ x: fmtShort(ms(x.finalizedAt)), y: x.points })), { title: 'Points per examination', bar: true })), h('div', { class: 'card' }, chart(e.map((x) => ({ x: fmtShort(ms(x.finalizedAt)), y: x.accuracy })), { title: 'Accuracy progression (%)', unit: '%' }))));
}
