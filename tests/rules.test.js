// Firestore Security Rules tests (Firebase Emulator). Run: npm i && npm run test:rules   (needs Java + firebase-tools)
// Expected PERMISSION_DENIED results in the negative tests are the PASSING outcome (assertFails).
import test from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'quizverse-test', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
const NOW = Date.now(); // fixed so seeded deadlines can be matched exactly
const ago = (m) => Timestamp.fromMillis(NOW - m * 60000), ahead = (m) => Timestamp.fromMillis(NOW + m * 60000);
const exam = (o = {}) => ({ title: 'E', description: 'd', category: 'c', difficulty: 'mixed', publicationStatus: 'published', durationMinutes: 20, maxAttempts: 2, questionCount: 2, questionIds: ['q1', 'q2'], openingAt: null, closingAt: null, ...o });
const layout = { order: ['q1', 'q2'], optOrder: { q1: [0, 1, 2, 3], q2: [0, 1, 2, 3] } };
const att = (h, examId, n, o = {}) => ({ userId: h, examId, examTitle: 'E', attemptNumber: n, status: 'in_progress', startedAt: ago(1), durationMinutes: 20, closingAt: null, questionCount: 2, layout, ...o });

test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    for (const [id, e] of Object.entries({ pub: exam(), draft: exam({ publicationStatus: 'draft' }), closed: exam({ closingAt: ago(5) }), future: exam({ openingAt: ahead(60) }), live: exam(), old: exam({ durationMinutes: 1 }), one: exam({ maxAttempts: 1 }) })) {
      await setDoc(doc(d, 'exams', id), e);
      await setDoc(doc(d, 'examQuestions', id), { questions: [{ id: 'q1', question: 'Q1', options: ['a', 'b', 'c', 'd'], difficulty: 'easy', points: 100 }] });
      await setDoc(doc(d, 'examKeys', id), { answers: { q1: { correct: 1, explanation: 'x' } } });
    }
    await setDoc(doc(d, 'attempts', 'loge_live_1'), att('loge', 'live', 1));
    await setDoc(doc(d, 'attemptLocks', 'loge_live'), { userId: 'loge', examId: 'live', count: 1, activeAttemptId: 'loge_live_1' });
    await setDoc(doc(d, 'attempts', 'loge_old_1'), att('loge', 'old', 1, { startedAt: ago(10), durationMinutes: 1 }));
    await setDoc(doc(d, 'attemptLocks', 'loge_old'), { userId: 'loge', examId: 'old', count: 1, activeAttemptId: 'loge_old_1' });
    await setDoc(doc(d, 'attempts', 'jana_pub_1'), att('jana', 'pub', 1, { status: 'submitted', submittedAt: ago(1), finalizedAt: ago(1), finalizedBy: 'jana' }));
    await setDoc(doc(d, 'attemptLocks', 'jana_pub'), { userId: 'jana', examId: 'pub', count: 1, activeAttemptId: null });
    await setDoc(doc(d, 'attempts', 'jana_pub_1', 'qs', 'q1'), { selected: 1, t: ago(1) });
    await setDoc(doc(d, 'attempts', 'loge_live_1', 'qs', 'q1'), { v: ago(1) });
    await setDoc(doc(d, 'users', 'loge'), { displayName: 'Loge', role: 'user', accountStatus: 'active', createdAt: ago(9), lastLoginAt: ago(9), lastActivityAt: ago(9) });
  });
});
test.after(() => env.cleanup());
const as = (h) => env.authenticatedContext('uid-' + h, { email: `${h}@quizverse.app` }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const startBatch = (db, h, ex, n, over = {}, lock = {}) => { const b = writeBatch(db), id = `${h}_${ex}_${n}`;
  b.set(doc(db, 'attempts', id), { userId: h, examId: ex, examTitle: 'E', attemptNumber: n, status: 'in_progress', startedAt: serverTimestamp(), durationMinutes: 20, closingAt: null, questionCount: 2, layout, ...over });
  b.set(doc(db, 'attemptLocks', `${h}_${ex}`), { userId: h, examId: ex, count: n, activeAttemptId: id, ...lock }); return b; };

// 1 / 6: access control
test('unauthenticated and foreign-email users get nothing', async () => {
  await assertFails(getDoc(doc(anon(), 'exams/pub'))); await assertFails(getDoc(doc(anon(), 'users/loge')));
  const stranger = env.authenticatedContext('x', { email: 'mallory@quizverse.app' }).firestore();
  await assertFails(getDoc(doc(stranger, 'exams/pub')));
});
test('users read published exams only; drafts are hidden', async () => {
  const db = as('loge');
  await assertSucceeds(getDoc(doc(db, 'exams/pub'))); await assertFails(getDoc(doc(db, 'exams/draft')));
  await assertSucceeds(getDocs(query(collection(db, 'exams'), where('publicationStatus', '==', 'published'))));
  await assertFails(getDocs(collection(db, 'exams')));
  await assertSucceeds(getDoc(doc(as('abood'), 'exams/draft')));
});
// 5 + delayed reveal
test('answer key is hidden while the user can still benefit', async () => {
  const db = as('loge');
  await assertFails(getDoc(doc(db, 'examKeys/pub')));     // never attempted
  await assertFails(getDoc(doc(db, 'examKeys/live')));    // attempt in progress
  await assertSucceeds(getDoc(doc(as('abood'), 'examKeys/pub')));
  await assertFails(getDocs(collection(db, 'examKeys')));
});
test('key is released only after attempts are exhausted (no active attempt) or the exam closed', async () => {
  const j = as('jana');
  await assertFails(getDoc(doc(j, 'examKeys/pub')));       // 1 of 2 attempts used -> still useful
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'attemptLocks/jana_pub'), { userId: 'jana', examId: 'pub', count: 2, activeAttemptId: null }));
  await assertSucceeds(getDoc(doc(j, 'examKeys/pub')));
  await assertSucceeds(getDoc(doc(as('kinda'), 'examKeys/closed')));
  await assertFails(getDoc(doc(as('kinda'), 'examKeys/draft')));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'attemptLocks/jana_draft'), { userId: 'jana', examId: 'draft', count: 2, activeAttemptId: null }));
  await assertFails(getDoc(doc(j, 'examKeys/draft')));     // unpublished: never
});
test('questions are readable only during a live attempt (or after reveal)', async () => {
  await assertFails(getDoc(doc(as('kinda'), 'examQuestions/pub')));
  await assertSucceeds(getDoc(doc(as('loge'), 'examQuestions/live')));
  await assertFails(getDoc(doc(as('loge'), 'examQuestions/old')));   // attempt expired
  await assertFails(getDoc(doc(as('loge'), 'examQuestions/pub')));
});
// 2 / 3 / 9: attempts
test('attempts: owner/admin read all; others only finalized metadata; nobody writes others', async () => {
  await assertSucceeds(getDoc(doc(as('loge'), 'attempts/loge_live_1'))); await assertSucceeds(getDoc(doc(as('abood'), 'attempts/loge_live_1')));
  await assertFails(getDoc(doc(as('jana'), 'attempts/loge_live_1')));
  await assertSucceeds(getDoc(doc(as('kinda'), 'attempts/jana_pub_1')));
  await assertSucceeds(getDocs(query(collection(as('kinda'), 'attempts'), where('status', 'in', ['submitted', 'timed_out']))));
  await assertFails(getDocs(collection(as('kinda'), 'attempts')));
  await assertFails(updateDoc(doc(as('jana'), 'attempts/loge_live_1'), { status: 'submitted' }));
  await assertFails(setDoc(doc(as('jana'), 'attempts/loge_live_1/qs/q1'), { selected: 0, t: serverTimestamp() }));
  await assertFails(deleteDoc(doc(as('loge'), 'attempts/loge_live_1')));
});
test("other users' raw answers stay hidden until the viewer's own reveal", async () => {
  await assertFails(getDoc(doc(as('kinda'), 'attempts/jana_pub_1/qs/q1')));
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'attemptLocks/kinda_pub'), { userId: 'kinda', examId: 'pub', count: 2, activeAttemptId: null }));
  await assertSucceeds(getDoc(doc(as('kinda'), 'attempts/jana_pub_1/qs/q1')));
  await assertSucceeds(getDoc(doc(as('jana'), 'attempts/jana_pub_1/qs/q1')));
});
test('starting an attempt: valid path, and every forgery is rejected', async () => {
  const k = as('kinda');
  await assertSucceeds(startBatch(k, 'kinda', 'pub', 1).commit());
  await assertFails(startBatch(as('jana'), 'jana', 'pub', 3).commit());                               // beyond limit / skipped number
  await assertFails(startBatch(k, 'kinda', 'draft', 1).commit());                                   // unpublished
  await assertFails(startBatch(k, 'kinda', 'closed', 1).commit());                                  // closed
  await assertFails(startBatch(k, 'kinda', 'future', 1).commit());                                  // not open yet
  await assertFails(startBatch(k, 'kinda', 'pub', 1, { startedAt: ago(0) }).commit());              // client clock
  await assertFails(startBatch(k, 'kinda', 'pub', 1, { totalPoints: 99999 }).commit());              // injected score
  await assertFails(startBatch(k, 'kinda', 'pub', 1, { durationMinutes: 9999 }).commit());          // longer timer
  await assertFails(startBatch(k, 'kinda', 'pub', 1, { userId: 'jana' }).commit());                  // impersonation
  await assertFails(startBatch(k, 'kinda', 'pub', 1, { layout: { order: ['q1', 'zz'], optOrder: {} } }).commit());
  await assertFails(setDoc(doc(k, 'attempts', 'kinda_pub_1'), att('kinda', 'pub', 1, { startedAt: serverTimestamp() }))); // no lock update
});
test('only one active attempt and a hard attempt limit', async () => {
  await assertFails(startBatch(as('loge'), 'loge', 'live', 2).commit());                             // active one still open
  const b = as('jana'); await assertSucceeds(startBatch(b, 'jana', 'pub', 2).commit());
  await assertFails(startBatch(b, 'jana', 'pub', 3).commit());
});
test('lock cannot be reset, deleted or written alone', async () => {
  const db = as('loge');
  await assertFails(setDoc(doc(db, 'attemptLocks/loge_live'), { userId: 'loge', examId: 'live', count: 0, activeAttemptId: null }));
  await assertFails(deleteDoc(doc(db, 'attemptLocks/loge_live')));
  await assertFails(setDoc(doc(as('jana'), 'attemptLocks/loge_live'), { userId: 'jana', examId: 'live', count: 0, activeAttemptId: null }));
});
// 7 / 14: answers (no client score/correctness fields exist)
test('answers: server-timestamped, bounded, owner-only, live-only', async () => {
  const q = (db, id = 'loge_live_1', qid = 'q2') => doc(db, 'attempts', id, 'qs', qid), l = as('loge');
  await assertSucceeds(setDoc(q(l), { selected: 2, t: serverTimestamp() }));
  await assertSucceeds(setDoc(q(l), { selected: null, t: serverTimestamp() }, { merge: true }));   // clear
  await assertFails(setDoc(q(l), { selected: 4, t: serverTimestamp() }));
  await assertFails(setDoc(q(l), { selected: 1, t: ago(30) }));                                      // forged time
  await assertFails(setDoc(q(l), { selected: 1, t: serverTimestamp(), correct: true, bonus: 25 })); // forged correctness/bonus
  await assertFails(setDoc(q(l, 'loge_live_1', 'zz'), { selected: 1, t: serverTimestamp() }));      // unknown question
  await assertFails(setDoc(q(as('jana')), { selected: 1, t: serverTimestamp() }));                   // someone else's attempt
  await assertFails(setDoc(q(l, 'loge_old_1', 'q1'), { selected: 1, t: serverTimestamp() }));        // after deadline
  await assertFails(updateDoc(q(l, 'loge_live_1', 'q1'), { v: serverTimestamp() }));                  // first-view time is immutable
  await assertFails(deleteDoc(q(l, 'loge_live_1', 'q1')));
  await assertSucceeds(setDoc(q(l, 'loge_live_1', 'q1'), { selected: 1, t: serverTimestamp() }, { merge: true }));          // answer after a view keeps v
});
// 4 / 12 / 13: finalization
const fin = (db, id, ex, h, extra = {}, release = true, kind = 'early') => { const b = writeBatch(db);
  b.update(doc(db, 'attempts', id), { status: kind === 'early' ? 'submitted' : 'timed_out', ...(kind === 'early' ? { submittedAt: serverTimestamp() } : {}), finalizedAt: serverTimestamp(), finalizedBy: h, ...extra });
  if (release) b.update(doc(db, 'attemptLocks', `${id.split('_')[0]}_${ex}`), { activeAttemptId: null }); return b; };
test('finalize: early submit by owner works; forged fields, missing lock release and other users fail', async () => {
  await assertFails(fin(as('loge'), 'loge_live_1', 'live', 'loge', { totalPoints: 1e9 }).commit());
  await assertFails(fin(as('loge'), 'loge_live_1', 'live', 'loge', { accuracy: 100 }).commit());
  await assertFails(fin(as('loge'), 'loge_live_1', 'live', 'loge', {}, false).commit());
  await assertFails(fin(as('jana'), 'loge_live_1', 'live', 'jana').commit());
  await assertFails(fin(as('abood'), 'loge_live_1', 'live', 'abood').commit());                     // admin cannot end a live attempt early
  await assertFails(fin(as('loge'), 'loge_live_1', 'live', 'loge', { submittedAt: ago(0) }).commit());
  await assertSucceeds(fin(as('loge'), 'loge_live_1', 'live', 'loge').commit());
  await assertFails(updateDoc(doc(as('loge'), 'attempts/loge_live_1'), { status: 'in_progress' }));  // no re-opening
});
test('finalize: expired attempt must be closed at exactly its deadline; admin may do it', async () => {
  const dl = ago(9);                                                                                  // start(-10m) + 1m
  await assertFails(fin(as('loge'), 'loge_old_1', 'old', 'loge', { submittedAt: ago(0) }, true, 'late').commit());
  await assertSucceeds(fin(as('abood'), 'loge_old_1', 'old', 'abood', { submittedAt: dl }, true, 'late').commit());
});
// 8 / 10 / 11: privileges
test('users cannot grant themselves admin or edit admin data', async () => {
  const db = as('loge');
  await assertFails(setDoc(doc(db, 'users/loge'), { displayName: 'Loge', role: 'admin', accountStatus: 'active', createdAt: serverTimestamp(), lastLoginAt: serverTimestamp(), lastActivityAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, 'users/loge'), { role: 'admin', lastActivityAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db, 'users/loge'), { lastActivityAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'users/jana'), { displayName: 'Jana', role: 'user', accountStatus: 'active', createdAt: serverTimestamp(), lastLoginAt: serverTimestamp(), lastActivityAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, 'exams/x'), exam())); await assertFails(updateDoc(doc(db, 'exams/pub'), { title: 'hacked' }));
  await assertFails(setDoc(doc(db, 'examKeys/pub'), { answers: {} })); await assertFails(setDoc(doc(db, 'examQuestions/pub'), { questions: [] }));
  await assertFails(deleteDoc(doc(db, 'exams/pub')));
});
test('admin can create, edit, publish, unpublish, duplicate and delete exams; invalid shapes are refused', async () => {
  const a = as('abood');
  await assertSucceeds(setDoc(doc(a, 'exams/new'), exam({ publicationStatus: 'draft', questionCount: 0, questionIds: [] })));
  await assertSucceeds(setDoc(doc(a, 'examQuestions/new'), { questions: [] })); await assertSucceeds(setDoc(doc(a, 'examKeys/new'), { answers: {} }));
  await assertFails(updateDoc(doc(a, 'exams/new'), { publicationStatus: 'published' }));            // nothing to publish
  await assertSucceeds(updateDoc(doc(a, 'exams/pub'), { publicationStatus: 'draft' })); await assertSucceeds(updateDoc(doc(a, 'exams/pub'), { publicationStatus: 'published' }));
  await assertSucceeds(setDoc(doc(a, 'exams/copy'), exam({ title: 'Copy of E', publicationStatus: 'draft' })));
  await assertFails(setDoc(doc(a, 'exams/bad'), exam({ durationMinutes: 0 }))); await assertFails(setDoc(doc(a, 'exams/bad2'), exam({ maxAttempts: 'many' })));
  await assertSucceeds(deleteDoc(doc(a, 'exams/copy')));
});
test('audit log: attribution is enforced, admin actions are admin-only, reads are admin-only', async () => {
  const l = as('loge'), e = (o) => ({ actorUserId: 'loge', action: 'login_success', examId: null, attemptId: null, timestamp: serverTimestamp(), metadata: {}, ...o });
  await assertSucceeds(setDoc(doc(l, 'activityLogs/a'), e({})));
  await assertFails(setDoc(doc(l, 'activityLogs/b'), e({ actorUserId: 'abood' })));
  await assertFails(setDoc(doc(l, 'activityLogs/c'), e({ action: 'exam_deleted' })));
  await assertFails(setDoc(doc(l, 'activityLogs/d'), e({ timestamp: ago(500) })));
  await assertFails(updateDoc(doc(l, 'activityLogs/a'), { action: 'exam_started' })); await assertFails(deleteDoc(doc(l, 'activityLogs/a')));
  await assertFails(getDoc(doc(l, 'activityLogs/a'))); await assertSucceeds(getDoc(doc(as('abood'), 'activityLogs/a')));
  await assertSucceeds(setDoc(doc(as('abood'), 'activityLogs/z'), e({ actorUserId: 'abood', action: 'exam_deleted' })));
});
test('everything else is closed by default', async () => {
  await assertFails(setDoc(doc(as('abood'), 'pinSecrets/loge'), { hash: 'x' })); await assertFails(getDoc(doc(as('abood'), 'leaderboardSummaries/loge')));
});
