import test from 'node:test';
import assert from 'node:assert/strict';
import { speedBonus, scoreAttempt, questionBudget } from '../public/js/scoring.js';
import { parseExamJson, validateExam } from '../public/js/validation.js';

test('speed bonus formula and edge cases', () => {
  assert.equal(speedBonus(100, 0, 60), 25);
  assert.equal(speedBonus(200, 30, 60), 25);
  assert.equal(speedBonus(300, 60, 60), 0);
  assert.equal(speedBonus(300, 999, 60), 0);
  assert.equal(speedBonus(100, -5, 60), 0);       // negative elapsed gives nothing
  assert.equal(speedBonus(100, NaN, 60), 0);
  assert.equal(speedBonus(100, 1, 0), 0);
  for (let e = 0; e <= 100; e++) assert.ok(speedBonus(100, e, 60) <= 100);
});
test('default budget derives from duration and count', () => {
  assert.equal(questionBudget({}, 1200, 20), 60);
  assert.equal(questionBudget({ timeBudgetSeconds: 15 }, 1200, 20), 15);
});
const questions = { a: { id: 'a', difficulty: 'easy', points: 100 }, b: { id: 'b', difficulty: 'hard', points: 300 }, c: { id: 'c', difficulty: 'medium', points: 200 } };
const keys = { a: { correct: 1 }, b: { correct: 2 }, c: { correct: 0 } };
test('scoring: correct, incorrect, unanswered, late answers', () => {
  const r = scoreAttempt({ order: ['a', 'b', 'c'], questions, keys, startedAtMs: 0, deadlineMs: 600000, durationSeconds: 600,
    answers: { a: { s: 1, t: 0 }, b: { s: 0, t: 5000 }, c: { s: 0, t: 700000 } }, views: {} });
  assert.equal(r.correctCount, 1); assert.equal(r.incorrectCount, 1); assert.equal(r.unansweredCount, 1);
  assert.equal(r.basePoints, 100); assert.equal(r.speedBonus, 25); assert.equal(r.totalPoints, 125);
  assert.equal(r.maxBasePoints, 600); assert.equal(r.accuracy, 33.33);
});
test('validation accepts the sample and rejects bad input', () => {
  const ok = { schemaVersion: 1, title: 'T', description: 'D', category: 'C', difficulty: 'mixed', durationMinutes: 20, maxAttempts: 3, openingAt: null, closingAt: null,
    questions: [{ id: 'q1', question: 'Q?', options: ['1', '2', '3', '4'], correctAnswer: 1, difficulty: 'easy', points: 100, explanation: 'x' }] };
  assert.equal(validateExam(ok).ok, true);
  const bad = (m) => validateExam(m(structuredClone(ok))).ok;
  assert.equal(bad((o) => { o.questions[0].correctAnswer = 4; return o; }), false);
  assert.equal(bad((o) => { o.questions[0].options.pop(); return o; }), false);
  assert.equal(bad((o) => { o.questions.push({ ...o.questions[0] }); return o; }), false);
  assert.equal(bad((o) => { o.durationMinutes = 0; return o; }), false);
  assert.equal(bad((o) => { o.schemaVersion = 2; return o; }), false);
  assert.equal(bad((o) => { o.closingAt = '2026-01-01T00:00:00Z'; o.openingAt = '2026-02-01T00:00:00Z'; return o; }), false);
  assert.equal(parseExamJson('{nope').ok, false);
});

// ---- delayed-reveal scoring is recomputed from raw server-timestamped data ----
test('scoring: answers after the deadline and unanswered score zero; elapsed is measured from first view', () => {
  const r = scoreAttempt({ order: ['a', 'b', 'c'], questions, keys, startedAtMs: 0, deadlineMs: 600000, durationSeconds: 600,
    answers: { a: { s: 1, t: 30000 }, b: { s: 2, t: 600001 } }, views: { a: 20000 } });
  assert.equal(r.items[0].isCorrect, true); assert.equal(r.items[0].elapsedSeconds, 10);
  assert.equal(r.items[1].isCorrect, false); assert.equal(r.unansweredCount, 2); // late b + never-answered c
  assert.equal(r.speedBonus, Math.floor(100 * 0.25 * (1 - 10 / 200))); // budget = 600/3 = 200 s
});
test('scoring: a view earlier than the attempt start cannot create a bonus advantage', () => {
  const r = scoreAttempt({ order: ['a'], questions, keys, startedAtMs: 100000, deadlineMs: 700000, durationSeconds: 600, answers: { a: { s: 1, t: 100000 } }, views: { a: -999999 } });
  assert.equal(r.items[0].elapsedSeconds, 0);
});
