// Authoritative scoring (server only). speedBonus = floor(base * 0.25 * max(0, 1 - elapsed/budget)).
export const SPEED_FACTOR = 0.25;
export const DEFAULT_POINTS = { easy: 100, medium: 200, hard: 300 };

export function basePoints(q) {
  return Number.isInteger(q.points) && q.points > 0 ? q.points : DEFAULT_POINTS[q.difficulty] ?? 100;
}
export function questionBudget(q, durationSeconds, count) {
  if (Number.isFinite(q.timeBudgetSeconds) && q.timeBudgetSeconds > 0) return q.timeBudgetSeconds;
  return Math.max(5, Math.floor(durationSeconds / Math.max(1, count)));
}
export function speedBonus(base, elapsedSeconds, budgetSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || !(budgetSeconds > 0) || !(base > 0)) return 0;
  const bonus = Math.floor(base * SPEED_FACTOR * Math.max(0, 1 - elapsedSeconds / budgetSeconds));
  return Math.min(base, Math.max(0, bonus));
}
/**
 * answers: {qid:{s:selectedOriginalIndex,t:serverMs}}, views: {qid:serverMs}
 * Elapsed per question = answer time - max(first view time, attempt start). All timestamps are server-recorded.
 */
export function scoreAttempt({ order, questions, keys, answers = {}, views = {}, startedAtMs, deadlineMs, durationSeconds }) {
  const ids = order.filter((id) => questions[id] && keys[id]);
  const items = [];
  let correctCount = 0, incorrectCount = 0, unansweredCount = 0, base = 0, bonus = 0, answeredCount = 0, maxBasePoints = 0;
  for (const id of ids) {
    const q = questions[id], key = keys[id], a = answers?.[id];
    const bp = basePoints(q);
    maxBasePoints += bp;
    const answered = a && Number.isInteger(a.s) && a.s >= 0 && a.s <= 3 && Number.isFinite(a.t) && a.t <= deadlineMs;
    if (!answered) { unansweredCount++; items.push({ id, selected: null, isCorrect: false, base: 0, bonus: 0, score: 0, elapsedSeconds: null }); continue; }
    answeredCount++;
    const from = Math.max(Number.isFinite(views?.[id]) ? views[id] : startedAtMs, startedAtMs);
    const elapsed = (a.t - from) / 1000;
    const isCorrect = a.s === key.correct;
    if (isCorrect) {
      const b = speedBonus(bp, elapsed, questionBudget(q, durationSeconds, ids.length));
      correctCount++; base += bp; bonus += b;
      items.push({ id, selected: a.s, isCorrect, base: bp, bonus: b, score: bp + b, elapsedSeconds: Math.max(0, Math.round(elapsed * 10) / 10) });
    } else {
      incorrectCount++;
      items.push({ id, selected: a.s, isCorrect, base: 0, bonus: 0, score: 0, elapsedSeconds: Math.max(0, Math.round(elapsed * 10) / 10) });
    }
  }
  const accuracy = ids.length ? Math.round((correctCount / ids.length) * 10000) / 100 : 0;
  return { items, correctCount, incorrectCount, unansweredCount, answeredCount, basePoints: base, speedBonus: bonus, totalPoints: base + bonus, maxBasePoints, accuracy };
}
