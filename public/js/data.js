import { db, collection, getDocs, query, where, orderBy, limit, startAfter } from './api.js';
export const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
export const USER_META = { abood: { name: 'Abood', role: 'admin' }, loge: { name: 'Loge', role: 'user' }, jana: { name: 'Jana', role: 'user' }, kinda: { name: 'Kinda', role: 'user' } };
export const COMPLETED = ['submitted', 'timed_out'];
export const STATUS_LABEL = { in_progress: 'In progress', submitted: 'Submitted', timed_out: 'Timed out', abandoned: 'Abandoned' };
export const statusClass = (s) => ({ submitted: 'ok', timed_out: 'warn', abandoned: 'bad', in_progress: 'acc' })[s] || '';

export async function loadSummaries() { const s = await getDocs(collection(db, 'leaderboardSummaries')); return s.docs.map((d) => ({ userId: d.id, ...d.data() })); }
/** Rank: total points desc, then average accuracy desc, then lower total completion seconds. */
export const sortBoard = (rows) => [...rows].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0) || (b.averageAccuracy || 0) - (a.averageAccuracy || 0) || (a.totalCompletionSeconds || 0) - (b.totalCompletionSeconds || 0));
export async function loadExams() { const s = await getDocs(query(collection(db, 'exams'), where('publicationStatus', '==', 'published'))); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
export async function loadAttempts(uid, { size = 20, after = null, status = null } = {}) {
  const c = [];
  if (uid) c.push(where('userId', '==', uid));
  if (status) c.push(where('status', '==', status));
  c.push(orderBy('startedAt', 'desc')); if (after) c.push(startAfter(after)); c.push(limit(size));
  const s = await getDocs(query(collection(db, 'attempts'), ...c));
  return { rows: s.docs.map((d) => ({ id: d.id, ...d.data() })), last: s.docs[s.docs.length - 1] || null, more: s.docs.length === size };
}
export function availability(e, now = Date.now()) {
  const o = ms(e.openingAt), c = ms(e.closingAt);
  if (c != null && c <= now) return 'closed'; if (o != null && o > now) return 'upcoming'; return 'open';
}
