import { db, collection, getDocs, query, where, orderBy, limit, startAfter } from './api.js';
import { enrich } from './services.js';
export const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
export const USER_META = { abood: { name: 'Abood', role: 'admin' }, loge: { name: 'Loge', role: 'user' }, jana: { name: 'Jana', role: 'user' }, kinda: { name: 'Kinda', role: 'user' } };
export const COMPLETED = ['submitted', 'timed_out'];
export const STATUS_LABEL = { in_progress: 'In progress', submitted: 'Submitted', timed_out: 'Timed out', abandoned: 'Abandoned' };
export const statusClass = (s) => ({ submitted: 'ok', timed_out: 'warn', abandoned: 'bad', in_progress: 'acc' })[s] || '';

// Run async work over a list with limited concurrency.
async function pool(items, fn, n = 6) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

/** Everything the leaderboard needs, recomputed from raw finalized attempts. Attempts whose key is not yet revealed to the viewer are `pending` and not ranked. */
let boardCache = null;
export function clearBoardCache() { boardCache = null; }
export async function loadBoardData() {
  if (boardCache) return boardCache;
  const snap = await getDocs(query(collection(db, 'attempts'), where('status', 'in', COMPLETED), limit(500)));
  const rows = await pool(snap.docs.map((d) => ({ id: d.id, ...d.data() })), enrich);
  const by = {}, entries = [];
  for (const id of Object.keys(USER_META)) by[id] = { userId: id, totalPoints: 0, completedAttempts: 0, accuracySum: 0, averageAccuracy: 0, bestScore: 0, totalCompletionSeconds: 0, attemptsStarted: 0, pendingAttempts: 0 };
  for (const a of rows) {
    const s = by[a.userId]; if (!s) continue; s.attemptsStarted++;
    if (a.pending) { s.pendingAttempts++; continue; }
    if (a.status === 'abandoned') continue;
    s.totalPoints += a.totalPoints; s.completedAttempts++; s.accuracySum += a.accuracy; s.bestScore = Math.max(s.bestScore, a.totalPoints); s.totalCompletionSeconds += a.elapsedSeconds || 0;
    entries.push({ userId: a.userId, examId: a.examId, points: a.totalPoints, accuracy: a.accuracy, seconds: a.elapsedSeconds || 0, finalizedAt: a.submittedAt });
  }
  for (const s of Object.values(by)) s.averageAccuracy = s.completedAttempts ? Math.round((s.accuracySum / s.completedAttempts) * 100) / 100 : 0;
  entries.sort((x, y) => ms(x.finalizedAt) - ms(y.finalizedAt));
  return (boardCache = { summaries: Object.values(by), entries });
}
export async function loadSummaries() { return (await loadBoardData()).summaries; }
/** Summaries restricted to attempts finalized at/after `since` (ms). */
export async function loadSummariesSince(since) {
  const { entries } = await loadBoardData(), by = {};
  for (const e of entries) { if (ms(e.finalizedAt) < since) continue; const s = (by[e.userId] ||= { userId: e.userId, totalPoints: 0, completedAttempts: 0, accSum: 0, bestScore: 0, totalCompletionSeconds: 0 }); s.totalPoints += e.points; s.completedAttempts++; s.accSum += e.accuracy; s.bestScore = Math.max(s.bestScore, e.points); s.totalCompletionSeconds += e.seconds; }
  return Object.values(by).map((s) => ({ ...s, averageAccuracy: s.accSum / s.completedAttempts }));
}
/** Rank: total points desc, then average accuracy desc, then lower total completion seconds. */
export const sortBoard = (rows) => [...rows].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || (b.averageAccuracy || 0) - (a.averageAccuracy || 0) || (a.totalCompletionSeconds || 0) - (b.totalCompletionSeconds || 0));
export async function loadExams() { const s = await getDocs(query(collection(db, 'exams'), where('publicationStatus', '==', 'published'))); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
export async function loadAttempts(uid, { size = 20, after = null, status = null } = {}) {
  const c = [];
  if (uid) c.push(where('userId', '==', uid));
  if (status) c.push(where('status', '==', status === 'abandoned' ? 'timed_out' : status));
  c.push(orderBy('startedAt', 'desc')); if (after) c.push(startAfter(after)); c.push(limit(size));
  const s = await getDocs(query(collection(db, 'attempts'), ...c));
  let rows = await pool(s.docs.map((d) => ({ id: d.id, ...d.data() })), enrich);
  if (status === 'abandoned') rows = rows.filter((a) => a.status === 'abandoned'); else if (status === 'timed_out') rows = rows.filter((a) => a.status === 'timed_out');
  return { rows, last: s.docs[s.docs.length - 1] || null, more: s.docs.length === size };
}
export function availability(e, now = Date.now()) {
  const o = ms(e.openingAt), c = ms(e.closingAt);
  if (c != null && c <= now) return 'closed'; if (o != null && o > now) return 'upcoming'; return 'open';
}
