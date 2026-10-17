// Security-rules tests for the Firestore emulator. NOT executed in the authoring environment (needs Java + emulator).
// Run: npm i && npm run test:rules
import test from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'quizverse-test', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'exams/pub'), { publicationStatus: 'published', title: 'P' });
  await setDoc(doc(db, 'exams/draft'), { publicationStatus: 'draft', title: 'D' });
  await setDoc(doc(db, 'examKeys/pub'), { answers: {} });
  await setDoc(doc(db, 'examQuestions/pub'), { questions: [] });
  await setDoc(doc(db, 'attempts/a1'), { userId: 'loge', totalPoints: 10 });
  await setDoc(doc(db, 'attempts/a2'), { userId: 'jana', totalPoints: 10 });
  await setDoc(doc(db, 'pinSecrets/loge'), { hash: 'x' });
  await setDoc(doc(db, 'activityLogs/l1'), { action: 'x' });
});
const as = (uid, role) => env.authenticatedContext(uid, { role }).firestore();
const anon = env.unauthenticatedContext().firestore();

test('unauthenticated access is denied', async () => { await assertFails(getDoc(doc(anon, 'exams/pub'))); await assertFails(getDoc(doc(anon, 'users/loge'))); });
test('users read only published exams', async () => {
  const db = as('loge', 'user');
  await assertSucceeds(getDoc(doc(db, 'exams/pub'))); await assertFails(getDoc(doc(db, 'exams/draft')));
  await assertSucceeds(getDocs(query(collection(db, 'exams'), where('publicationStatus', '==', 'published'))));
  await assertFails(getDocs(collection(db, 'exams')));
});
test('answer keys, questions, PIN secrets and logs are not readable by users', async () => {
  const db = as('loge', 'user');
  for (const p of ['examKeys/pub', 'examQuestions/pub', 'pinSecrets/loge', 'activityLogs/l1']) await assertFails(getDoc(doc(db, p)));
});
test('attempts: own only, no writes', async () => {
  const db = as('loge', 'user');
  await assertSucceeds(getDoc(doc(db, 'attempts/a1'))); await assertFails(getDoc(doc(db, 'attempts/a2')));
  await assertFails(updateDoc(doc(db, 'attempts/a1'), { totalPoints: 99999 }));
  await assertSucceeds(getDocs(query(collection(db, 'attempts'), where('userId', '==', 'loge'))));
  await assertFails(getDocs(collection(db, 'attempts')));
});
test('users cannot grant themselves admin or edit leaderboard', async () => {
  const db = as('loge', 'user');
  await assertFails(setDoc(doc(db, 'users/loge'), { role: 'admin' }));
  await assertFails(setDoc(doc(db, 'leaderboardSummaries/loge'), { totalPoints: 1e9 }));
  await assertFails(setDoc(doc(db, 'activityLogs/new'), { action: 'x' }));
});
test('admin reads everything except keys and secrets; cannot write directly', async () => {
  const db = as('abood', 'admin');
  await assertSucceeds(getDoc(doc(db, 'exams/draft'))); await assertSucceeds(getDoc(doc(db, 'examQuestions/pub')));
  await assertSucceeds(getDoc(doc(db, 'activityLogs/l1'))); await assertSucceeds(getDocs(collection(db, 'attempts')));
  await assertFails(getDoc(doc(db, 'examKeys/pub'))); await assertFails(getDoc(doc(db, 'pinSecrets/loge')));
  await assertFails(setDoc(doc(db, 'exams/x'), { title: 'x' }));
});
test.after(() => env.cleanup());
