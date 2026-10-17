// Shared exam validation. Pure ES module: used by Cloud Functions (authoritative) and
// copied to public/js/validation.js for instant client-side feedback. Never trust the client copy.
export const LIMITS = { maxChars: 400000, maxQuestions: 200 };
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const DEFAULT_POINTS = { easy: 100, medium: 200, hard: 300 };
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/;

function text(errs, path, v, { max, required = true } = {}) {
  if (v === undefined || v === null) { if (required) errs.push(`${path} is required.`); return ''; }
  if (typeof v !== 'string') { errs.push(`${path} must be text.`); return ''; }
  const t = v.trim();
  if (required && !t) errs.push(`${path} must not be empty.`);
  if (t.length > max) errs.push(`${path} is too long (max ${max} characters).`);
  return t;
}
function int(errs, path, v, { min = 1, max = 1e9, required = true } = {}) {
  if (v === undefined || v === null || v === '') { if (required) errs.push(`${path} is required.`); return null; }
  if (!Number.isInteger(v) || v < min || v > max) { errs.push(`${path} must be a whole number between ${min} and ${max}.`); return null; }
  return v;
}
function date(errs, path, v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !TZ_RE.test(v) || Number.isNaN(Date.parse(v))) {
    errs.push(`${path} must be null or an ISO date-time with a timezone, e.g. "2026-12-01T09:00:00+03:00".`); return null;
  }
  return new Date(v).toISOString();
}
function bool(errs, path, v, def) {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') { errs.push(`${path} must be true or false.`); return def; }
  return v;
}

export function validateExam(o) {
  const errs = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['The JSON root must be an object.'], exam: null };
  if (o.schemaVersion !== 1) errs.push('schemaVersion must be 1.');
  const e = {
    schemaVersion: 1,
    title: text(errs, 'title', o.title, { max: 150 }),
    description: text(errs, 'description', o.description, { max: 2000 }),
    category: text(errs, 'category', o.category, { max: 80 }),
    instructions: text(errs, 'instructions', o.instructions, { max: 3000, required: false }),
    difficulty: 'mixed',
    durationMinutes: int(errs, 'durationMinutes', o.durationMinutes, { max: 600 }),
    maxAttempts: int(errs, 'maxAttempts', o.maxAttempts, { max: 100 }),
    openingAt: date(errs, 'openingAt', o.openingAt),
    closingAt: date(errs, 'closingAt', o.closingAt),
    passingScore: int(errs, 'passingScore', o.passingScore, { min: 1, max: 100, required: false }),
    shuffleQuestions: bool(errs, 'shuffleQuestions', o.shuffleQuestions, false),
    shuffleOptions: bool(errs, 'shuffleOptions', o.shuffleOptions, false),
    showExplanations: bool(errs, 'showExplanations', o.showExplanations, true),
    allowReview: bool(errs, 'allowReview', o.allowReview, true),
    showCorrectAnswers: bool(errs, 'showCorrectAnswers', o.showCorrectAnswers, true),
    tags: [],
    questions: [],
  };
  if (o.difficulty !== undefined && o.difficulty !== null) {
    if ([...DIFFICULTIES, 'mixed'].includes(o.difficulty)) e.difficulty = o.difficulty;
    else errs.push('difficulty must be "easy", "medium", "hard" or "mixed".');
  }
  if (o.tags !== undefined && o.tags !== null) {
    if (!Array.isArray(o.tags) || o.tags.length > 10 || o.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 30)) errs.push('tags must be up to 10 short, non-empty strings.');
    else e.tags = o.tags.map((t) => t.trim());
  }
  if (e.openingAt && e.closingAt && Date.parse(e.closingAt) <= Date.parse(e.openingAt)) errs.push('closingAt must be later than openingAt.');
  if (!Array.isArray(o.questions) || o.questions.length === 0) errs.push('questions must be a non-empty array.');
  else if (o.questions.length > LIMITS.maxQuestions) errs.push(`Too many questions (max ${LIMITS.maxQuestions}).`);
  else {
    const seen = new Set();
    o.questions.forEach((q, i) => {
      const p = `Question ${i + 1}`;
      if (!q || typeof q !== 'object') { errs.push(`${p} must be an object.`); return; }
      const id = q.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) errs.push(`${p}: id must be 1-40 letters, digits, "_" or "-".`);
      else if (seen.has(id)) errs.push(`${p}: duplicate id "${id}".`);
      else seen.add(id);
      const question = text(errs, `${p}: question`, q.question, { max: 2000 });
      let options = [];
      if (!Array.isArray(q.options) || q.options.length !== 4) errs.push(`${p}: options must contain exactly 4 items.`);
      else {
        options = q.options.map((x, k) => text(errs, `${p}: option ${k + 1}`, x, { max: 500 }));
        if (new Set(options.map((x) => x.toLowerCase())).size !== 4 && options.every(Boolean)) errs.push(`${p}: the four options must be different.`);
      }
      const ca = q.correctAnswer;
      if (!Number.isInteger(ca) || ca < 0 || ca > 3) errs.push(`${p}: correctAnswer must be an index from 0 to 3.`);
      if (!DIFFICULTIES.includes(q.difficulty)) errs.push(`${p}: difficulty must be "easy", "medium" or "hard".`);
      const points = q.points === undefined || q.points === null ? DEFAULT_POINTS[q.difficulty] ?? 100 : int(errs, `${p}: points`, q.points, { max: 1000 });
      const tb = int(errs, `${p}: timeBudgetSeconds`, q.timeBudgetSeconds, { min: 5, max: 3600, required: false });
      const explanation = text(errs, `${p}: explanation`, q.explanation, { max: 2000, required: false });
      e.questions.push({ id, question, options, correctAnswer: ca, difficulty: q.difficulty, points, timeBudgetSeconds: tb, explanation });
    });
  }
  return { ok: errs.length === 0, errors: errs, exam: errs.length ? null : e };
}

export function parseExamJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, errors: ['Paste the JSON first.'], exam: null };
  if (raw.length > LIMITS.maxChars) return { ok: false, errors: [`The JSON is too large (max ${LIMITS.maxChars} characters).`], exam: null };
  let obj;
  try { obj = JSON.parse(raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')); }
  catch (err) { return { ok: false, errors: [`Invalid JSON syntax: ${err.message}`], exam: null }; }
  return validateExam(obj);
}
