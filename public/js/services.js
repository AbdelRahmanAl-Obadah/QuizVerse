// Replaces the former Cloud Functions. Every privileged rule is enforced by firestore.rules; this file only
// performs the allowed writes/reads. Nothing here is a security boundary.
import { auth, db, collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, serverTimestamp, Timestamp, limit, signInWithEmailAndPassword } from './api.js';
import { ACCOUNT_DOMAIN } from './firebase-config.js';
import { validateExam } from './validation.js';
import { scoreAttempt } from './scoring.js';

const err = (code, message, details) => Object.assign(new Error(message), { code, details });
const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
export const myHandle = () => auth.currentUser?.email?.split('@')[0] || null;
const isPerm = (e) => e?.code === 'permission-denied';
const NAMES = { abood: 'Abood', loge: 'Loge', jana: 'Jana', kinda: 'Kinda' };

// ---------------- auth ----------------
export async function login(handle, pin) {
  try { await signInWithEmailAndPassword(auth, `${handle}@${ACCOUNT_DOMAIN}`, pin); }
  catch (e) {
    const c = e.code || '';
    if (c.includes('too-many-requests')) throw err('resource-exhausted', 'Too many failed attempts. Wait a few minutes and try again.');
    if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) throw err('permission-denied', 'Wrong PIN, or this account has not been created yet. Ask Abood.');
    if (c.includes('network')) throw err('unavailable', 'Network problem. Check your connection and try again.');
    throw err('internal', 'Could not sign in. Try again.');
  }
  const b = writeBatch(db); logTo(b, 'login_success'); await b.commit().catch(() => {});
}
/** Create/refresh the public profile (display name + last activity). Best-effort; the app does not depend on it. */
export async function touchProfile() {
  const h = myHandle(), ref = doc(db, 'users', h);
  try {
    const s = await getDoc(ref);
    if (!s.exists()) await setDoc(ref, { displayName: NAMES[h], role: h === 'abood' ? 'admin' : 'user', accountStatus: 'active', createdAt: serverTimestamp(), lastLoginAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
    else await updateDoc(ref, { lastLoginAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
  } catch { /* ignore */ }
}
async function serverOffset() { // estimate (server clock - local clock); only for the countdown display, never for decisions
  const h = myHandle(), ref = doc(db, 'users', h), t0 = Date.now();
  try { await updateDoc(ref, { lastActivityAt: serverTimestamp() }); const t = ms((await getDoc(ref)).data().lastActivityAt); return t - (t0 + Date.now()) / 2; } catch { return 0; }
}
function logTo(batch, action, { examId = null, attemptId = null, metadata = {} } = {}) {
  batch.set(doc(collection(db, 'activityLogs')), { actorUserId: myHandle(), action, examId, attemptId, timestamp: serverTimestamp(), metadata });
}

// ---------------- admin: exams ----------------
const fromIso = (s) => (s ? Timestamp.fromDate(new Date(s)) : null);
const iso = (t) => (t ? t.toDate().toISOString() : null);
const examFields = (e) => ({
  title: e.title, description: e.description, category: e.category, difficulty: e.difficulty, durationMinutes: e.durationMinutes, maxAttempts: e.maxAttempts,
  openingAt: fromIso(e.openingAt), closingAt: fromIso(e.closingAt), instructions: e.instructions, tags: e.tags, passingScore: e.passingScore,
  shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions, showExplanations: e.showExplanations, allowReview: e.allowReview, showCorrectAnswers: e.showCorrectAnswers,
  questionCount: e.questions.length, questionIds: e.questions.map((q) => q.id),
});
const splitQuestions = (e) => ({
  qs: e.questions.map((q) => ({ id: q.id, question: q.question, options: q.options, difficulty: q.difficulty, points: q.points, timeBudgetSeconds: q.timeBudgetSeconds ?? null })),
  keys: Object.fromEntries(e.questions.map((q) => [q.id, { correct: q.correctAnswer, explanation: q.explanation || '' }])),
});
export async function adminSaveExam({ examId, exam, source }) {
  const v = validateExam(exam); if (!v.ok) throw err('invalid-argument', 'Validation failed.', { errors: v.errors });
  const e = v.exam, ref = examId ? doc(db, 'exams', examId) : doc(collection(db, 'exams'));
  const exists = examId ? (await getDoc(ref)).exists() : false; if (examId && !exists) throw err('not-found', 'Exam not found.');
  const { qs, keys } = splitQuestions(e), b = writeBatch(db), h = myHandle();
  if (exists) b.update(ref, { ...examFields(e), updatedAt: serverTimestamp() });
  else b.set(ref, { ...examFields(e), publicationStatus: 'draft', createdBy: h, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedAt: null });
  b.set(doc(db, 'examQuestions', ref.id), { questions: qs }); b.set(doc(db, 'examKeys', ref.id), { answers: keys });
  logTo(b, exists ? 'exam_edited' : source === 'import' ? 'exam_imported' : 'exam_created', { examId: ref.id, metadata: { title: e.title, questionCount: qs.length } });
  await b.commit(); return { examId: ref.id };
}
export async function adminGetExam({ examId }) {
  const [ex, qd, kd] = await Promise.all([getDoc(doc(db, 'exams', examId)), getDoc(doc(db, 'examQuestions', examId)), getDoc(doc(db, 'examKeys', examId))]);
  if (!ex.exists()) throw err('not-found', 'Exam not found.');
  const d = ex.data(), keys = kd.data()?.answers || {};
  return { examId, publicationStatus: d.publicationStatus, exam: {
    schemaVersion: 1, title: d.title, description: d.description, category: d.category, difficulty: d.difficulty, instructions: d.instructions || '', tags: d.tags || [],
    durationMinutes: d.durationMinutes, maxAttempts: d.maxAttempts, openingAt: iso(d.openingAt), closingAt: iso(d.closingAt), passingScore: d.passingScore ?? null,
    shuffleQuestions: d.shuffleQuestions, shuffleOptions: d.shuffleOptions, showExplanations: d.showExplanations, allowReview: d.allowReview, showCorrectAnswers: d.showCorrectAnswers,
    questions: (qd.data()?.questions || []).map((q) => ({ ...q, correctAnswer: keys[q.id]?.correct ?? 0, explanation: keys[q.id]?.explanation || '' })),
  } };
}
export async function adminSetStatus({ examId, status }) {
  const ref = doc(db, 'exams', examId), s = await getDoc(ref); if (!s.exists()) throw err('not-found', 'Exam not found.');
  if (status === 'published' && !(s.data().questionCount > 0)) throw err('failed-precondition', 'Add questions before publishing.');
  const b = writeBatch(db); b.update(ref, { publicationStatus: status, updatedAt: serverTimestamp(), ...(status === 'published' ? { publishedAt: serverTimestamp() } : {}) });
  logTo(b, status === 'published' ? 'exam_published' : 'exam_unpublished', { examId, metadata: { title: s.data().title } }); await b.commit();
}
export async function adminDeleteExam({ examId }) {
  const ref = doc(db, 'exams', examId), s = await getDoc(ref); if (!s.exists()) throw err('not-found', 'Exam not found.');
  if (!(await getDocs(query(collection(db, 'attempts'), where('examId', '==', examId), limit(1)))).empty) throw err('failed-precondition', 'This exam already has attempts. Unpublish it instead of deleting it.');
  const b = writeBatch(db); b.delete(ref); b.delete(doc(db, 'examQuestions', examId)); b.delete(doc(db, 'examKeys', examId));
  logTo(b, 'exam_deleted', { examId, metadata: { title: s.data().title } }); await b.commit();
}
export async function adminDuplicateExam({ examId }) {
  const [ex, qd, kd] = await Promise.all([getDoc(doc(db, 'exams', examId)), getDoc(doc(db, 'examQuestions', examId)), getDoc(doc(db, 'examKeys', examId))]);
  if (!ex.exists()) throw err('not-found', 'Exam not found.');
  const ref = doc(collection(db, 'exams')), d = ex.data(), b = writeBatch(db);
  b.set(ref, { ...d, title: `Copy of ${d.title}`.slice(0, 150), publicationStatus: 'draft', publishedAt: null, createdBy: myHandle(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(db, 'examQuestions', ref.id), qd.data()); b.set(doc(db, 'examKeys', ref.id), kd.data());
  logTo(b, 'exam_duplicated', { examId: ref.id, metadata: { from: examId } }); await b.commit(); return { examId: ref.id };
}

// ---------------- attempts ----------------
const aRef = (id) => doc(db, 'attempts', id), qsRef = (aid, qid) => doc(db, 'attempts', aid, 'qs', qid);
export const deadlineMs = (a) => Math.min(ms(a.startedAt) + a.durationMinutes * 60000, a.closingAt ? ms(a.closingAt) : Infinity);
function shuffle(a) { const r = [...a], u = new Uint32Array(r.length); crypto.getRandomValues(u); for (let i = r.length - 1; i > 0; i--) { const j = u[i] % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }

export async function startAttempt(examId) {
  const h = myHandle(); await finalizeExpiredFor(h);
  const lockRef = doc(db, 'attemptLocks', `${h}_${examId}`), [lock, ex] = await Promise.all([getDoc(lockRef), getDoc(doc(db, 'exams', examId))]);
  const l = lock.exists() ? lock.data() : { count: 0, activeAttemptId: null };
  if (l.activeAttemptId) return { attemptId: l.activeAttemptId };
  if (!ex.exists() || ex.data().publicationStatus !== 'published') throw err('not-found', 'This examination is not available.');
  const e = ex.data(), now = Date.now();
  if (e.openingAt && ms(e.openingAt) > now) throw err('failed-precondition', 'This examination has not opened yet.');
  if (e.closingAt && ms(e.closingAt) <= now) throw err('failed-precondition', 'This examination is closed.');
  if (l.count >= e.maxAttempts) throw err('resource-exhausted', 'You have used all attempts for this examination.');
  const ids = e.questionIds, order = e.shuffleQuestions ? shuffle(ids) : ids;
  const optOrder = Object.fromEntries(ids.map((id) => [id, e.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3]]));
  const n = l.count + 1, id = `${h}_${examId}_${n}`, b = writeBatch(db);
  b.set(aRef(id), { userId: h, examId, examTitle: e.title, attemptNumber: n, status: 'in_progress', startedAt: serverTimestamp(), durationMinutes: e.durationMinutes, closingAt: e.closingAt || null, questionCount: ids.length, layout: { order, optOrder } });
  b.set(lockRef, { userId: h, examId, count: n, activeAttemptId: id });
  logTo(b, 'exam_started', { examId, attemptId: id, metadata: { attemptNumber: n, title: e.title } });
  try { await b.commit(); } catch (x) { throw isPerm(x) ? err('failed-precondition', 'Could not start (the examination may have closed, or you have no attempts left).') : x; }
  return { attemptId: id };
}
/** Payload for the runner (questions WITHOUT keys; readable only while the attempt is live). */
export async function getAttempt(attemptId) {
  let s = await getDoc(aRef(attemptId)); if (!s.exists()) throw err('not-found', 'Attempt not found.');
  let a = s.data();
  const off = await serverOffset();
  if (a.status === 'in_progress' && Date.now() + off >= deadlineMs(a)) { await finalizeAttempt(attemptId, off); a = (await getDoc(aRef(attemptId))).data(); }
  const out = { id: attemptId, status: a.status, examId: a.examId, examTitle: a.examTitle, attemptNumber: a.attemptNumber, startedAt: ms(a.startedAt), deadlineAt: a.status === 'in_progress' ? deadlineMs(a) : null, serverNow: Date.now() + off };
  if (a.status !== 'in_progress') return out;
  const [qd, qsSnap] = await Promise.all([getDoc(doc(db, 'examQuestions', a.examId)), getDocs(collection(db, 'attempts', attemptId, 'qs'))]);
  const byId = Object.fromEntries((qd.data()?.questions || []).map((q) => [q.id, q]));
  out.questions = a.layout.order.filter((q) => byId[q]).map((qid) => { const q = byId[qid], perm = a.layout.optOrder[qid]; return { id: qid, question: q.question, options: perm.map((i) => q.options[i]), difficulty: q.difficulty, points: q.points }; });
  out.perm = a.layout.optOrder; out.answers = {}; out.viewed = [];
  qsSnap.docs.forEach((d) => { const x = d.data(); out.viewed.push(d.id); if (x.selected != null && a.layout.optOrder[d.id]) out.answers[d.id] = a.layout.optOrder[d.id].indexOf(x.selected); });
  return out;
}
export async function recordView(attemptId, qid) { try { await setDoc(qsRef(attemptId, qid), { v: serverTimestamp() }); } catch { /* already exists or expired */ } }
/** `selected` = ORIGINAL option index (the runner maps its shuffled position back) or null to clear. Rejected after the deadline. */
export async function saveAnswer(attemptId, qid, selected) { await setDoc(qsRef(attemptId, qid), { selected, t: serverTimestamp() }, { merge: true }); }

/** Idempotent. Tries the "early submit" form first when the (offset-corrected) clock is before the deadline, then the other. */
export async function finalizeAttempt(attemptId, offset = 0) {
  const s = await getDoc(aRef(attemptId)); if (!s.exists()) throw err('not-found', 'Attempt not found.');
  const a = s.data(), h = a.userId;
  if (a.status !== 'in_progress') return { attemptId, status: a.status, already: true };
  const dl = deadlineMs(a), tries = (Date.now() + offset < dl) ? ['early', 'late'] : ['late', 'early'];
  let last;
  for (const kind of tries) {
    const b = writeBatch(db), late = kind === 'late';
    b.update(aRef(attemptId), { status: late ? 'timed_out' : 'submitted', submittedAt: late ? Timestamp.fromMillis(dl) : serverTimestamp(), finalizedAt: serverTimestamp(), finalizedBy: myHandle() });
    b.update(doc(db, 'attemptLocks', `${h}_${a.examId}`), { activeAttemptId: null });
    logTo(b, late ? 'exam_timed_out' : 'exam_completed', { examId: a.examId, attemptId, metadata: { title: a.examTitle, by: myHandle() } });
    try { await b.commit(); return { attemptId, status: late ? 'timed_out' : 'submitted' }; } catch (x) { last = x; if (!isPerm(x)) break; }
  }
  const again = (await getDoc(aRef(attemptId))).data(); if (again.status !== 'in_progress') return { attemptId, status: again.status, already: true }; // finalized concurrently
  throw last;
}
export async function finalizeExpiredFor(handle) {
  const q = await getDocs(query(collection(db, 'attempts'), where('userId', '==', handle), where('status', '==', 'in_progress')));
  for (const d of q.docs) if (Date.now() >= deadlineMs(d.data())) { try { await finalizeAttempt(d.id); } catch { /* retried next time */ } }
}
/** Admin housekeeping replacing the scheduled sweeper: finalize every expired attempt. */
export async function adminFinalizeAllExpired() {
  const q = await getDocs(query(collection(db, 'attempts'), where('status', '==', 'in_progress')));
  for (const d of q.docs) if (Date.now() >= deadlineMs(d.data())) { try { await finalizeAttempt(d.id); } catch { /* ignore */ } }
}

// ---------------- reveal + scoring (client-side recomputation) ----------------
const revealCache = new Map(); // examId -> {keys, questions, exam} | null (denied)
export function clearScoreCache() { revealCache.clear(); }
export function resetSession() { revealCache.clear(); scored.clear(); }
async function reveal(examId) {
  if (revealCache.has(examId)) return revealCache.get(examId);
  let r = null;
  try {
    const [kd, qd] = await Promise.all([getDoc(doc(db, 'examKeys', examId)), getDoc(doc(db, 'examQuestions', examId))]);
    const ed = await getDoc(doc(db, 'exams', examId)).catch(() => null);
    if (kd.exists() && qd.exists()) r = { keys: kd.data().answers, questions: Object.fromEntries(qd.data().questions.map((q) => [q.id, q])), exam: ed?.exists() ? ed.data() : {} };
  } catch (e) { if (!isPerm(e)) throw e; }
  revealCache.set(examId, r); return r;
}
const scored = new Map();
/** Adds score fields when the key may be revealed to the caller; otherwise `pending: true`. Derives `abandoned`. */
export async function enrich(a) {
  if (a.status === 'in_progress') return { ...a, pending: true };
  if (a.totalPoints != null && a.layout?.order == null) return { ...a, pending: false }; // legacy attempt scored by the old backend: stored values are shown as-is
  if (scored.has(a.id)) return scored.get(a.id);
  const mine = a.userId === myHandle() || myHandle() === 'abood', elapsed = Math.max(0, Math.round((ms(a.submittedAt) - ms(a.startedAt)) / 1000));
  const base = { ...a, elapsedSeconds: elapsed };
  const rv = await reveal(a.examId);
  let docs = null;
  if (mine || rv) { try { docs = (await getDocs(collection(db, 'attempts', a.id, 'qs'))).docs; } catch (e) { if (!isPerm(e)) throw e; } }
  if (docs) base.answeredCount = docs.filter((d) => d.data().selected != null).length;
  if (docs && base.answeredCount === 0 && a.status === 'timed_out') base.status = 'abandoned';
  if (!rv || !docs) return { ...base, pending: true };
  const answers = {}, views = {};
  docs.forEach((d) => { const x = d.data(); if (x.v) views[d.id] = ms(x.v); if (x.selected != null) answers[d.id] = { s: x.selected, t: ms(x.t) }; });
  const r = scoreAttempt({ order: a.layout.order, questions: rv.questions, keys: rv.keys, answers, views, startedAtMs: ms(a.startedAt), deadlineMs: deadlineMs(a), durationSeconds: a.durationMinutes * 60 });
  const out = { ...base, pending: false, correctCount: r.correctCount, incorrectCount: r.incorrectCount, unansweredCount: r.unansweredCount, accuracy: r.accuracy, basePoints: r.basePoints, speedBonus: r.speedBonus, totalPoints: r.totalPoints, maxBasePoints: r.maxBasePoints, scoring: r.items };
  scored.set(a.id, out); return out;
}
export async function getResult(attemptId) {
  let s = await getDoc(aRef(attemptId)); if (!s.exists()) throw err('not-found', 'Attempt not found.');
  let a = { id: attemptId, ...s.data() };
  if (a.status === 'in_progress') {
    if (Date.now() < deadlineMs(a)) throw err('failed-precondition', 'This attempt is still in progress.');
    await finalizeAttempt(attemptId); a = { id: attemptId, ...(await getDoc(aRef(attemptId))).data() };
  }
  const attempt = await enrich(a), rv = await reveal(a.examId), isAdmin = myHandle() === 'abood';
  let review = null;
  if (rv && !attempt.pending && (isAdmin || rv.exam.allowReview || rv.exam.showCorrectAnswers)) {
    review = attempt.scoring.filter((i) => rv.questions[i.id]).map((i) => ({ id: i.id, question: rv.questions[i.id].question, options: rv.questions[i.id].options, selected: i.selected, isCorrect: i.isCorrect, score: i.score, bonus: i.bonus,
      ...(isAdmin || rv.exam.showCorrectAnswers ? { correct: rv.keys[i.id]?.correct } : {}), ...(isAdmin || rv.exam.showExplanations ? { explanation: rv.keys[i.id]?.explanation || '' } : {}) }));
  }
  attempt.passingScore = rv?.exam?.passingScore ?? null;
  return { attempt, review, pending: !!attempt.pending };
}
