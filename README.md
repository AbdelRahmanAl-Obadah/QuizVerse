# QuizVerse — private multiplayer quiz platform (no Cloud Functions)

Vanilla JS (ES modules) + **Firebase Authentication (email/password), Cloud Firestore + Security Rules, Firebase Hosting**.
No Cloud Functions, Cloud Run, Express or any other backend. Four fixed accounts: **Abood** (admin), **Loge**, **Jana**, **Kinda**.
Firebase project: `abood-cv`.

## 1. Architecture

| Concern | Design |
|---|---|
| Identity | Firebase Auth email/password. Accounts are `abood@quizverse.app`, `loge@…`, `jana@…`, `kinda@…` (synthetic, never emailed). The handle is the part before `@`. |
| "PIN" | The Firebase password. **Firebase requires ≥ 6 characters, so the PIN is now 6 digits.** Brute-force protection is Firebase Auth's built-in throttling (not configurable); the old 5-tries/15-min lock and the setup code no longer exist. |
| Roles | `abood` is admin **inside `firestore.rules`** (by verified email). No role is read from a document, from localStorage or from the UI. The `role` in the UI state is cosmetic. |
| Sign-up | Disable sign-up in the console (section 4) so nobody can create other accounts. |
| Exams | Admin writes `exams`, `examQuestions` (no keys), `examKeys` (keys + explanations). Rules allow writes to admin only and validate the exam shape. |
| Attempts | `attempts/{handle}_{examId}_{n}` + `attemptLocks/{handle}_{examId}` created together in one batch. Rules enforce: published and open, attempt number = previous + 1, ≤ `maxAttempts`, one active attempt, `startedAt` = server time, duration/closing time copied from the exam. |
| Answers | `attempts/{id}/qs/{questionId}`: `{v: firstShown}` and `{selected, t}`. `t`/`v` must equal the **server timestamp**; writes are rejected after the deadline (`min(startedAt + duration, closingAt)`). Clients cannot store correctness, points or bonuses: no such fields are accepted. |
| Finalization | Owner submits (server time must be before the deadline) or anyone allowed closes an expired attempt at exactly its deadline. Status, time fields and lock release are validated together. |
| **Delayed reveal** | `examKeys` and (after the attempt ends) `examQuestions` are readable by a user **only** when the exam is published and either (a) the exam's `closingAt` has passed or (b) the user has used all `maxAttempts` and has no active attempt. Questions are also readable while the user has a live attempt. Until then results show "answers saved, score pending". |
| Scoring | **Not stored.** After reveal each client recomputes scores from the protected raw data (`public/js/scoring.js`: base points + `floor(base × 0.25 × max(0, 1 − elapsed/budget))` speed bonus, accuracy). Leaderboard/history/profile are computed the same way. Others' attempts only count for a viewer once the key is revealed to that viewer. |
| Expired attempts | `sweepExpired` is gone. Expired attempts are finalized lazily: when their owner signs in/starts/opens them, and for everyone when Abood signs in or opens *All attempts*. Until then they show as in progress and the exam key stays locked for that user. |
| Audit log | `activityLogs` is written by clients with enforced attribution (`actorUserId` = caller, server timestamp, action allow-list, admin actions admin-only), read by admin only. |

Data model: `users` · `exams` (incl. `questionIds`) · `examQuestions` · `examKeys` · `attemptLocks` · `attempts` (+ `qs` subcollection) · `activityLogs`. Removed: `pinSecrets`, `leaderboardSummaries`, `leaderboardEntries`.

## 2. What is and is not guaranteed without a backend

**Enforced by Firestore Rules (server-side):** authentication; only the four accounts; admin-only exam writes; unpublished exams hidden; answer keys hidden until the reveal condition; question text hidden until an attempt is live; attempt ownership; attempt count and single active attempt; server-timestamped answers; no writes after the deadline; no client-supplied scores/correctness/bonus/time; no self-granted admin; immutable first-view time; no deletes of attempts/answers/logs.

**NOT guaranteed (cannot be done without trusted server code):**
- **Scores are not authoritative.** They are recomputed by each viewer's browser from protected data. A tampered browser can display wrong numbers *to itself* but cannot change anyone else's data, and every viewer recomputes independently.
- **Speed bonus is gameable.** The "first shown" time `v` is written by the client; a user can delay it. Treat the (≤ 25%) bonus as best-effort. Correctness cannot be gamed.
- **Answer reuse in multi-attempt exams is prevented only by delayed reveal**, which is why scores for exams with several attempts appear after the last attempt (or at closing). A user still remembers questions between attempts.
- **PIN strength.** Firebase throttles guessing, but a 6-digit PIN is weak against a determined attacker. Treat this as a private family app; consider longer passwords (see section 4).
- **Collusion.** Once you have used all attempts you may read other users' finalized raw answers for that exam.
- **Admin is fully trusted** (can read keys, edit exams after attempts, change `maxAttempts`/`closingAt`, which can re-open or leak the key).
- **Audit log** entries by a user about themselves can be forged (e.g. a fake `exam_completed`); they are advisory.
- **Rules cannot enforce "no questions before open" for an already-started attempt, rate limits, or per-request IP limits.** Enable Firebase App Check if you need more.
- Editing an exam's questions after attempts changes how stored answers re-score.

## 3. Behaviour changes versus the Cloud Functions version
- 4-digit PIN → 6-digit PIN; setup code and custom lock removed; users cannot set their own first PIN (admin creates accounts).
- Scores/key reveal are delayed as above (previously instant).
- Admin cannot delete an exam that has attempts (checked in the UI; the admin is trusted) and no per-exam `attemptCount`.
- Old attempts scored by the previous backend are shown with their stored values (read-only). Old exams must be **re-saved once** in the editor (adds `questionIds`) before they can be attempted.
- The app UI is English only (no Arabic UI existed in this codebase).

## 4. Setup (nothing here is done automatically)
Prerequisites: Node 20+, `npm i -g firebase-tools`, Java (tests only).
1. Firebase console → project **abood-cv** → Authentication → Sign-in method → enable **Email/Password**.
2. Authentication → Users → **Add user** four times: `abood@quizverse.app`, `loge@quizverse.app`, `jana@quizverse.app`, `kinda@quizverse.app`, each with a 6-digit numeric password (the PIN) you give to that person. (Different, longer passwords also work, but the login box accepts 6 digits.)
3. Authentication → Settings → User actions → **disable "Enable create (sign-up)"**.
4. Project settings → Your apps → Web app: paste `apiKey` and `appId` into `public/js/firebase-config.js` (`projectId`/`authDomain` are preset to `abood-cv`).
5. PIN reset = change the password of that user in the console.
6. Old backend cleanup (optional, your call): previously deployed functions keep running/billing until removed with `firebase functions:delete <name> --project abood-cv`; old `pinSecrets`, `leaderboard*`, `attemptCount` data is unused and can be deleted from the console.

### Deploy (manual)
```
# 1) Hosting (new frontend)
firebase deploy --only hosting --project abood-cv
# 2) Rules + indexes: deploy rules together with (or right after) the new frontend. They are incompatible with the OLD
#    frontend and the old frontend is incompatible with them, so do both in one sitting after the tests pass:
firebase deploy --only firestore:rules,firestore:indexes --project abood-cv
```
Never run a bare `firebase deploy` from an old checkout (it would try to deploy the removed functions target).
Local: `firebase emulators:start` (Auth + Firestore + Hosting), set `USE_EMULATORS = true` in `firebase-config.js`, create the four users in the Auth emulator UI.

## 5. Tests
- `npm test`: unit tests for scoring (correct/incorrect/unanswered/late answers, speed bonus) and exam validation.
- `npm run test:rules`: Firestore Security Rules tests (emulator): unauthenticated access, own/foreign attempts, unpublished exams, key and question reveal timing, forged starts/answers/finalization, admin escalation, admin exam CRUD, audit-log attribution. Needs Java and `firebase-tools`. Expected permission-denied results are passing outcomes.

## Layout
`public/` static app (hash routes) · `public/js/services.js` all Firestore operations (replaces the former functions) · `firestore.rules` · `firestore.indexes.json` · `firebase.json` (Hosting + Firestore only) · `.firebaserc` (`abood-cv`) · `tests/`.
