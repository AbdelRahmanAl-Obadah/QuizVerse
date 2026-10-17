// QuizVerse trusted backend. Everything privileged happens here (Admin SDK bypasses Firestore rules);
// clients can only READ a limited set of collections (see firestore.rules) and never write.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import { validateExam } from './lib/validation.js';
import { scoreAttempt } from './lib/scoring.js';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
initializeApp();
const db = getFirestore();

// Roles live in code (trusted), not in anything a client can write. Only abood is admin.
const USERS = {
  abood: { displayName: 'Abood', role: 'admin' },
  loge: { displayName: 'Loge', role: 'user' },
  jana: { displayName: 'Jana', role: 'user' },
  kinda: { displayName: 'Kinda', role: 'user' },
};
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
const bad = (code, msg, details) => new HttpsError(code, msg, details);
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);
const iso = (t) => (t ? t.toDate().toISOString() : null);
const ms = (t) => (t ? t.toMillis() : null);
const fromIso = (s) => (s ? Timestamp.fromDate(new Date(s)) : null);
const SERVER_TS = () => FieldValue.serverTimestamp();

function authed(req) {
  if (!req.auth) throw bad('unauthenticated', 'Please sign in.');
  const u = USERS[req.auth.uid];
  if (!u) throw bad('permission-denied', 'Unknown user.');
  return { uid: req.auth.uid, role: u.role };
}
function adminOnly(req) {
  const a = authed(req);
  if (a.role !== 'admin') throw bad('permission-denied', 'Administrator only.');
  return a;
}
// ---- audit log (server-only writes; PINs are never passed in) ----
const logData = (o) => ({ actorUserId: o.actor, action: o.action, examId: o.examId ?? null, attemptId: o.attemptId ?? null, timestamp: SERVER_TS(), metadata: o.metadata || {} });
const log = (o) => db.collection('activityLogs').doc().set(logData(o));
const logTx = (tx, o) => tx.set(db.collection('activityLogs').doc(), logData(o));
function shuffle(a) { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; }

// ===================== PIN AUTH =====================
const PEPPER = () => process.env.PIN_PEPPER || '';
const hashPin = (pin, salt) => crypto.scryptSync(pin + PEPPER(), salt, 32);
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export const pinStatus = onCall(async () => {
  const ids = Object.keys(USERS);
  const snaps = await db.getAll(...ids.map((id) => db.doc(`pinSecrets/${id}`)));
  const status = {}; snaps.forEach((s, i) => (status[ids[i]] = s.exists));
  return { status, setupCodeRequired: !!process.env.SETUP_CODE };
});

export const loginWithPin = onCall(async (req) => {
  const { userId, pin, mode, setupCode } = req.data || {};
  if (typeof userId !== 'string' || !USERS[userId]) throw bad('invalid-argument', 'Unknown user.');
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw bad('invalid-argument', 'The PIN must be exactly 4 digits.');
  const u = USERS[userId];
  const ref = db.doc(`pinSecrets/${userId}`);
  if (mode === 'setup') {
    if (process.env.SETUP_CODE && !safeEq(setupCode || '', process.env.SETUP_CODE)) {
      await log({ actor: userId, action: 'login_failed', metadata: { reason: 'bad_setup_code' } });
      throw bad('permission-denied', 'That setup code is not correct.');
    }
    const salt = crypto.randomBytes(16);
    try {
      await ref.create({ salt: salt.toString('base64'), hash: hashPin(pin, salt).toString('base64'), failed: 0, lockedUntil: 0, createdAt: SERVER_TS() });
    } catch (e) { if (e.code === 6) throw bad('already-exists', 'A PIN is already set for this user.'); throw e; }
    await log({ actor: userId, action: 'pin_setup' });
  } else {
    const out = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return { r: 'nosetup' };
      const d = s.data(), now = Date.now();
      if (d.lockedUntil > now) return { r: 'locked', until: d.lockedUntil };
      const ok = safeEq(hashPin(pin, Buffer.from(d.salt, 'base64')).toString('base64'), d.hash);
      if (ok) { if (d.failed) tx.update(ref, { failed: 0, lockedUntil: 0 }); return { r: 'ok' }; }
      const failed = (d.failed || 0) + 1, lock = failed >= MAX_FAILS;
      tx.update(ref, { failed: lock ? 0 : failed, lockedUntil: lock ? now + LOCK_MS : 0 });
      return { r: 'bad', failed, lock };
    });
    if (out.r === 'nosetup') throw bad('failed-precondition', 'No PIN has been set for this user yet.');
    if (out.r === 'locked') throw bad('resource-exhausted', `Too many wrong PINs. Try again in ${Math.ceil((out.until - Date.now()) / 60000)} minute(s).`);
    if (out.r === 'bad') {
      await log({ actor: userId, action: 'login_failed', metadata: { reason: 'wrong_pin', locked: out.lock } });
      throw bad('permission-denied', out.lock ? 'Wrong PIN. This user is now locked for 15 minutes.' : `Wrong PIN. ${MAX_FAILS - out.failed} attempt(s) left before a temporary lock.`);
    }
  }
  await db.doc(`users/${userId}`).set({ displayName: u.displayName, role: u.role, accountStatus: 'active', lastLoginAt: SERVER_TS(), lastActivityAt: SERVER_TS(), createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await log({ actor: userId, action: 'login_success' });
  const token = await getAuth().createCustomToken(userId, { role: u.role });
  return { token };
});

// ===================== ADMIN: EXAMS =====================
function examFields(e) {
  return {
    title: e.title, description: e.description, category: e.category, difficulty: e.difficulty,
    durationMinutes: e.durationMinutes, maxAttempts: e.maxAttempts, openingAt: fromIso(e.openingAt), closingAt: fromIso(e.closingAt),
    instructions: e.instructions, tags: e.tags, passingScore: e.passingScore,
    shuffleQuestions: e.shuffleQuestions, shuffleOptions: e.shuffleOptions, showExplanations: e.showExplanations,
    allowReview: e.allowReview, showCorrectAnswers: e.showCorrectAnswers, questionCount: e.questions.length,
  };
}
const splitQuestions = (e) => ({
  qs: e.questions.map((q) => ({ id: q.id, question: q.question, options: q.options, difficulty: q.difficulty, points: q.points, timeBudgetSeconds: q.timeBudgetSeconds ?? null })),
  keys: Object.fromEntries(e.questions.map((q) => [q.id, { correct: q.correctAnswer, explanation: q.explanation || '' }])),
});

export const adminSaveExam = onCall(async (req) => {
  const { uid } = adminOnly(req);
  const { examId, exam, source } = req.data || {};
  if (examId && !idOk(examId)) throw bad('invalid-argument', 'Bad exam id.');
  const v = validateExam(exam);
  if (!v.ok) throw bad('invalid-argument', 'Validation failed.', { errors: v.errors });
  const e = v.exam, ref = examId ? db.doc(`exams/${examId}`) : db.collection('exams').doc();
  const { qs, keys } = splitQuestions(e);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (examId && !s.exists) throw bad('not-found', 'Exam not found.');
    if (s.exists) tx.update(ref, { ...examFields(e), updatedAt: SERVER_TS() });
    else tx.set(ref, { ...examFields(e), publicationStatus: 'draft', createdBy: uid, createdAt: SERVER_TS(), updatedAt: SERVER_TS(), publishedAt: null, attemptCount: 0 });
    tx.set(db.doc(`examQuestions/${ref.id}`), { questions: qs });
    tx.set(db.doc(`examKeys/${ref.id}`), { answers: keys });
    logTx(tx, { actor: uid, action: s.exists ? 'exam_edited' : source === 'import' ? 'exam_imported' : 'exam_created', examId: ref.id, metadata: { title: e.title, questionCount: qs.length } });
  });
  return { examId: ref.id };
});

export const adminGetExam = onCall(async (req) => {
  adminOnly(req);
  const id = req.data?.examId;
  if (!idOk(id)) throw bad('invalid-argument', 'Bad exam id.');
  const [ex, qd, kd] = await Promise.all([db.doc(`exams/${id}`).get(), db.doc(`examQuestions/${id}`).get(), db.doc(`examKeys/${id}`).get()]);
  if (!ex.exists) throw bad('not-found', 'Exam not found.');
  const d = ex.data(), keys = kd.data()?.answers || {};
  return {
    examId: id, publicationStatus: d.publicationStatus,
    exam: {
      schemaVersion: 1, title: d.title, description: d.description, category: d.category, difficulty: d.difficulty, instructions: d.instructions || '', tags: d.tags || [],
      durationMinutes: d.durationMinutes, maxAttempts: d.maxAttempts, openingAt: iso(d.openingAt), closingAt: iso(d.closingAt), passingScore: d.passingScore ?? null,
      shuffleQuestions: d.shuffleQuestions, shuffleOptions: d.shuffleOptions, showExplanations: d.showExplanations, allowReview: d.allowReview, showCorrectAnswers: d.showCorrectAnswers,
      questions: (qd.data()?.questions || []).map((q) => ({ ...q, correctAnswer: keys[q.id]?.correct ?? 0, explanation: keys[q.id]?.explanation || '' })),
    },
  };
});

export const adminSetStatus = onCall(async (req) => {
  const { uid } = adminOnly(req);
  const { examId, status } = req.data || {};
  if (!idOk(examId) || !['published', 'draft'].includes(status)) throw bad('invalid-argument', 'Bad request.');
  const ref = db.doc(`exams/${examId}`);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw bad('not-found', 'Exam not found.');
    if (status === 'published' && !(s.data().questionCount > 0)) throw bad('failed-precondition', 'Add questions before publishing.');
    tx.update(ref, { publicationStatus: status, updatedAt: SERVER_TS(), ...(status === 'published' ? { publishedAt: SERVER_TS() } : {}) });
    logTx(tx, { actor: uid, action: status === 'published' ? 'exam_published' : 'exam_unpublished', examId, metadata: { title: s.data().title } });
  });
  return { ok: true };
});

export const adminDeleteExam = onCall(async (req) => {
  const { uid } = adminOnly(req);
  const id = req.data?.examId;
  if (!idOk(id)) throw bad('invalid-argument', 'Bad exam id.');
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.doc(`exams/${id}`));
    if (!s.exists) throw bad('not-found', 'Exam not found.');
    if ((s.data().attemptCount || 0) > 0) throw bad('failed-precondition', 'This exam already has attempts. Unpublish it instead of deleting it.');
    tx.delete(s.ref); tx.delete(db.doc(`examQuestions/${id}`)); tx.delete(db.doc(`examKeys/${id}`));
    logTx(tx, { actor: uid, action: 'exam_deleted', examId: id, metadata: { title: s.data().title } });
  });
  return { ok: true };
});

export const adminDuplicateExam = onCall(async (req) => {
  const { uid } = adminOnly(req);
  const id = req.data?.examId;
  if (!idOk(id)) throw bad('invalid-argument', 'Bad exam id.');
  const [ex, qd, kd] = await Promise.all([db.doc(`exams/${id}`).get(), db.doc(`examQuestions/${id}`).get(), db.doc(`examKeys/${id}`).get()]);
  if (!ex.exists) throw bad('not-found', 'Exam not found.');
  const ref = db.collection('exams').doc(), d = ex.data();
  const batch = db.batch();
  batch.set(ref, { ...d, title: `Copy of ${d.title}`.slice(0, 150), publicationStatus: 'draft', attemptCount: 0, publishedAt: null, createdBy: uid, createdAt: SERVER_TS(), updatedAt: SERVER_TS() });
  batch.set(db.doc(`examQuestions/${ref.id}`), qd.data()); batch.set(db.doc(`examKeys/${ref.id}`), kd.data());
  batch.set(db.collection('activityLogs').doc(), logData({ actor: uid, action: 'exam_duplicated', examId: ref.id, metadata: { from: id } }));
  await batch.commit();
  return { examId: ref.id };
});

// ===================== ATTEMPTS =====================
export const startAttempt = onCall(async (req) => {
  const { uid } = authed(req);
  const examId = req.data?.examId;
  if (!idOk(examId)) throw bad('invalid-argument', 'Bad exam id.');
  await finalizeExpiredFor(uid);
  const examRef = db.doc(`exams/${examId}`), lockRef = db.doc(`attemptLocks/${uid}_${examId}`);
  const attemptId = await db.runTransaction(async (tx) => {
    const [ex, lock, qd] = await Promise.all([tx.get(examRef), tx.get(lockRef), tx.get(db.doc(`examQuestions/${examId}`))]);
    if (!ex.exists || ex.data().publicationStatus !== 'published') throw bad('not-found', 'This examination is not available.');
    const e = ex.data(), now = Date.now(), l = lock.exists ? lock.data() : { count: 0, activeAttemptId: null };
    if (l.activeAttemptId) return l.activeAttemptId; // resume the single active attempt
    if (e.openingAt && e.openingAt.toMillis() > now) throw bad('failed-precondition', 'This examination has not opened yet.');
    if (e.closingAt && e.closingAt.toMillis() <= now) throw bad('failed-precondition', 'This examination is closed.');
    if (l.count >= e.maxAttempts) throw bad('resource-exhausted', 'You have used all attempts for this examination.');
    const qs = qd.data()?.questions || [];
    if (!qs.length) throw bad('failed-precondition', 'This examination has no questions.');
    const ids = qs.map((q) => q.id);
    const order = e.shuffleQuestions ? shuffle(ids) : ids;
    const optOrder = Object.fromEntries(ids.map((id) => [id, e.shuffleOptions ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3]]));
    const deadline = Math.min(now + e.durationMinutes * 60000, e.closingAt ? e.closingAt.toMillis() : Infinity);
    const aRef = db.collection('attempts').doc();
    tx.set(aRef, { userId: uid, examId, examTitle: e.title, attemptNumber: l.count + 1, status: 'in_progress', startedAt: Timestamp.fromMillis(now), deadlineAt: Timestamp.fromMillis(deadline), durationMinutes: e.durationMinutes, questionCount: ids.length, answers: {}, views: {}, layout: { order, optOrder } });
    tx.set(lockRef, { userId: uid, examId, count: l.count + 1, activeAttemptId: aRef.id });
    tx.update(examRef, { attemptCount: FieldValue.increment(1) });
    tx.set(db.doc(`leaderboardSummaries/${uid}`), { userId: uid, displayName: USERS[uid].displayName, attemptsStarted: FieldValue.increment(1), updatedAt: SERVER_TS() }, { merge: true });
    tx.set(db.doc(`users/${uid}`), { lastActivityAt: SERVER_TS() }, { merge: true });
    logTx(tx, { actor: uid, action: 'exam_started', examId, attemptId: aRef.id, metadata: { attemptNumber: l.count + 1, title: e.title } });
    return aRef.id;
  });
  return { attemptId };
});

async function attemptPayload(id, who) {
  let snap = await db.doc(`attempts/${id}`).get();
  if (!snap.exists) throw bad('not-found', 'Attempt not found.');
  let a = snap.data();
  if (a.userId !== who.uid && who.role !== 'admin') throw bad('permission-denied', 'Not your attempt.');
  if (a.status === 'in_progress' && Date.now() >= ms(a.deadlineAt)) { await finalizeCore(id, 'system'); a = (await db.doc(`attempts/${id}`).get()).data(); }
  const out = { id, status: a.status, examId: a.examId, examTitle: a.examTitle, attemptNumber: a.attemptNumber, startedAt: ms(a.startedAt), deadlineAt: ms(a.deadlineAt), serverNow: Date.now() };
  if (a.status === 'in_progress') {
    const qd = await db.doc(`examQuestions/${a.examId}`).get();
    const byId = Object.fromEntries((qd.data()?.questions || []).map((q) => [q.id, q]));
    out.questions = a.layout.order.filter((q) => byId[q]).map((qid) => {
      const q = byId[qid], perm = a.layout.optOrder[qid];
      return { id: qid, question: q.question, options: perm.map((i) => q.options[i]), difficulty: q.difficulty, points: q.points };
    });
    out.answers = {};
    for (const [qid, ans] of Object.entries(a.answers || {})) if (a.layout.optOrder[qid]) out.answers[qid] = a.layout.optOrder[qid].indexOf(ans.s);
  }
  return out;
}
export const getAttempt = onCall(async (req) => {
  const who = authed(req);
  if (!idOk(req.data?.attemptId)) throw bad('invalid-argument', 'Bad attempt id.');
  return attemptPayload(req.data.attemptId, who);
});

export const attemptEvent = onCall(async (req) => {
  const { uid } = authed(req);
  const { attemptId, qid, type, selected } = req.data || {};
  if (!idOk(attemptId) || !idOk(qid)) throw bad('invalid-argument', 'Bad request.');
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`attempts/${attemptId}`), s = await tx.get(ref);
    if (!s.exists || s.data().userId !== uid) throw bad('not-found', 'Attempt not found.');
    const a = s.data(), now = Date.now();
    if (a.status !== 'in_progress') throw bad('failed-precondition', 'This attempt is already finalized.');
    if (now >= ms(a.deadlineAt)) throw bad('deadline-exceeded', 'Time is up.');
    const perm = a.layout.optOrder[qid];
    if (!perm) throw bad('invalid-argument', 'Unknown question.');
    if (type === 'view') { if (a.views?.[qid] == null) tx.update(ref, new FieldPath('views', qid), now); return { ok: true }; }
    if (type === 'answer') {
      if (selected === null) tx.update(ref, new FieldPath('answers', qid), FieldValue.delete());
      else {
        if (!Number.isInteger(selected) || selected < 0 || selected > 3) throw bad('invalid-argument', 'Bad option.');
        tx.update(ref, new FieldPath('answers', qid), { s: perm[selected], t: now });
        logTx(tx, { actor: uid, action: 'answer_submitted', examId: a.examId, attemptId, metadata: { questionId: qid } });
      }
      return { ok: true, savedAt: now };
    }
    throw bad('invalid-argument', 'Bad event type.');
  });
});

// Idempotent: a finalized attempt returns immediately and never awards points twice (single transaction).
async function finalizeCore(attemptId, actor) {
  const aRef = db.doc(`attempts/${attemptId}`);
  return db.runTransaction(async (tx) => {
    const aSnap = await tx.get(aRef);
    if (!aSnap.exists) throw bad('not-found', 'Attempt not found.');
    const a = aSnap.data();
    if (a.status !== 'in_progress') return { attemptId, status: a.status, already: true };
    const sRef = db.doc(`leaderboardSummaries/${a.userId}`);
    const [qd, kd, ed, sd] = await Promise.all([tx.get(db.doc(`examQuestions/${a.examId}`)), tx.get(db.doc(`examKeys/${a.examId}`)), tx.get(db.doc(`exams/${a.examId}`)), tx.get(sRef)]);
    const now = Date.now(), startedMs = ms(a.startedAt), deadlineMs = ms(a.deadlineAt);
    const questions = Object.fromEntries((qd.data()?.questions || []).map((q) => [q.id, q]));
    const res = scoreAttempt({ order: a.layout.order, questions, keys: kd.data()?.answers || {}, answers: a.answers, views: a.views, startedAtMs: startedMs, deadlineMs, durationSeconds: (ed.data()?.durationMinutes || a.durationMinutes) * 60 });
    const timedOut = now >= deadlineMs;
    const status = timedOut ? (res.answeredCount === 0 ? 'abandoned' : 'timed_out') : 'submitted';
    const endMs = Math.min(now, deadlineMs), elapsed = Math.max(0, Math.round((endMs - startedMs) / 1000));
    tx.update(aRef, {
      status, submittedAt: Timestamp.fromMillis(endMs), finalizedAt: SERVER_TS(), finalizedBy: actor, elapsedSeconds: elapsed,
      correctCount: res.correctCount, incorrectCount: res.incorrectCount, unansweredCount: res.unansweredCount, accuracy: res.accuracy,
      basePoints: res.basePoints, speedBonus: res.speedBonus, totalPoints: res.totalPoints, maxBasePoints: res.maxBasePoints, scoring: res.items,
    });
    tx.set(db.doc(`attemptLocks/${a.userId}_${a.examId}`), { activeAttemptId: null }, { merge: true });
    tx.set(db.doc(`users/${a.userId}`), { lastActivityAt: SERVER_TS() }, { merge: true });
    if (status !== 'abandoned') {
      const s = sd.exists ? sd.data() : {};
      const completed = (s.completedAttempts || 0) + 1, accSum = (s.accuracySum || 0) + res.accuracy;
      tx.set(sRef, {
        userId: a.userId, displayName: USERS[a.userId].displayName, totalPoints: (s.totalPoints || 0) + res.totalPoints, completedAttempts: completed,
        accuracySum: accSum, averageAccuracy: Math.round((accSum / completed) * 100) / 100, bestScore: Math.max(s.bestScore || 0, res.totalPoints),
        totalCompletionSeconds: (s.totalCompletionSeconds || 0) + elapsed, updatedAt: SERVER_TS(),
      }, { merge: true });
      tx.set(db.doc(`leaderboardEntries/${attemptId}`), { userId: a.userId, examId: a.examId, points: res.totalPoints, accuracy: res.accuracy, seconds: elapsed, finalizedAt: Timestamp.fromMillis(endMs) });
    }
    logTx(tx, { actor: a.userId, action: status === 'submitted' ? 'exam_completed' : status === 'timed_out' ? 'exam_timed_out' : 'exam_abandoned', examId: a.examId, attemptId, metadata: { totalPoints: res.totalPoints, accuracy: res.accuracy, by: actor } });
    return { attemptId, status, totalPoints: res.totalPoints };
  });
}
async function finalizeExpiredFor(uid) {
  const q = await db.collection('attempts').where('userId', '==', uid).where('status', '==', 'in_progress').get();
  for (const d of q.docs) if (Date.now() >= ms(d.data().deadlineAt)) await finalizeCore(d.id, 'system');
}
export const finalizeAttempt = onCall(async (req) => {
  const { uid, role } = authed(req);
  const id = req.data?.attemptId;
  if (!idOk(id)) throw bad('invalid-argument', 'Bad attempt id.');
  const s = await db.doc(`attempts/${id}`).get();
  if (!s.exists || (s.data().userId !== uid && role !== 'admin')) throw bad('not-found', 'Attempt not found.');
  return finalizeCore(id, uid);
});

export const getResult = onCall(async (req) => {
  const who = authed(req);
  const id = req.data?.attemptId;
  if (!idOk(id)) throw bad('invalid-argument', 'Bad attempt id.');
  let snap = await db.doc(`attempts/${id}`).get();
  if (!snap.exists) throw bad('not-found', 'Attempt not found.');
  let a = snap.data();
  if (a.userId !== who.uid && who.role !== 'admin') throw bad('permission-denied', 'Not your attempt.');
  if (a.status === 'in_progress') {
    if (Date.now() < ms(a.deadlineAt)) throw bad('failed-precondition', 'This attempt is still in progress.');
    await finalizeCore(id, 'system'); a = (await db.doc(`attempts/${id}`).get()).data();
  }
  const [ex, qd, kd] = await Promise.all([db.doc(`exams/${a.examId}`).get(), db.doc(`examQuestions/${a.examId}`).get(), db.doc(`examKeys/${a.examId}`).get()]);
  const e = ex.data() || {}, isAdmin = who.role === 'admin';
  const attempt = {
    id, userId: a.userId, examId: a.examId, examTitle: a.examTitle, attemptNumber: a.attemptNumber, status: a.status, startedAt: ms(a.startedAt), submittedAt: ms(a.submittedAt),
    elapsedSeconds: a.elapsedSeconds, correctCount: a.correctCount, incorrectCount: a.incorrectCount, unansweredCount: a.unansweredCount, accuracy: a.accuracy,
    basePoints: a.basePoints, speedBonus: a.speedBonus, totalPoints: a.totalPoints, maxBasePoints: a.maxBasePoints, questionCount: a.questionCount, passingScore: e.passingScore ?? null,
  };
  let review = null;
  if (isAdmin || e.allowReview || e.showCorrectAnswers) {
    const byId = Object.fromEntries((qd.data()?.questions || []).map((q) => [q.id, q])), keys = kd.data()?.answers || {};
    review = (a.scoring || []).filter((i) => byId[i.id]).map((i) => ({
      id: i.id, question: byId[i.id].question, options: byId[i.id].options, selected: i.selected, isCorrect: i.isCorrect, score: i.score, bonus: i.bonus,
      ...(isAdmin || e.showCorrectAnswers ? { correct: keys[i.id]?.correct } : {}),
      ...(isAdmin || e.showExplanations ? { explanation: keys[i.id]?.explanation || '' } : {}),
    }));
  }
  return { attempt, review };
});

// Marks attempts whose deadline passed (users who closed the tab) so they appear as timed out / abandoned.
export const sweepExpired = onSchedule('every 15 minutes', async () => {
  const q = await db.collection('attempts').where('status', '==', 'in_progress').where('deadlineAt', '<', Timestamp.now()).limit(100).get();
  for (const d of q.docs) { try { await finalizeCore(d.id, 'system'); } catch (e) { console.error('sweep failed', d.id, e); } }
});
