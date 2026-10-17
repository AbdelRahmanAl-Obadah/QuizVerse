# QuizVerse — private multiplayer quiz platform

Vanilla JS (ES modules) + Firebase (Auth, Firestore, Cloud Functions, Hosting). Four fixed users: **Abood** (admin), **Loge**, **Jana**, **Kinda**.

## 1. Architecture and PIN-authentication security

**Why a backend is required.** Firestore rules cannot hash or compare a PIN, and a PIN check in browser JavaScript is not authorization. So a Cloud Function (`loginWithPin`) verifies PINs and issues a Firebase **custom token** whose uid is the user id (`abood`, `loge`, …). Firestore rules then trust only `request.auth`.

| Concern | Design |
|---|---|
| PIN storage | scrypt hash + random salt (+ optional `PIN_PEPPER`) in `pinSecrets/{user}`; rules deny all client access. Never logged. |
| Brute force | 10,000 possible PINs is weak, so: 5 wrong PINs → 15-minute lock per user, logged. **A 4-digit PIN still offers limited security**; treat this as a private-family app, not a bank. |
| First-time setup | Whoever sets a name's PIN first owns it. Set `SETUP_CODE` (functions/.env) and share it only with the four people, or set all four PINs yourself first. Without it, anyone who finds the site can claim an unclaimed name. |
| Roles | Hard-coded in the function (`abood` = admin). Users cannot register names, and no client can write the `users` collection. |
| Writes | **Clients cannot write anything.** Exams, attempts, scores, leaderboard, logs are all written by functions (Admin SDK). |
| Answer keys | `examKeys/{id}` is unreadable by every client (even Abood); only functions read it. Questions reach users through `startAttempt`/`getAttempt`, answers are never sent. Abood edits via `adminGetExam`. |
| Timing | Deadline = min(start + duration, closingAt), stored server-side; refresh rebuilds the timer from `deadlineAt`. Answer timestamps are server time. |
| Attempt limits | `startAttempt` transaction on a lock doc `attemptLocks/{user}_{exam}` (count + single active attempt) so double clicks/tabs cannot exceed the limit. |
| Finalization | One transaction; already-finalized attempts return immediately, so points are never awarded twice. Sweeper (`sweepExpired`, every 15 min) finalizes abandoned tabs. |

Private app vs. private network: Hosting files are public downloads; privacy comes from the PIN/backend/rules, not from hiding the URL. For network-level privacy you would need IAP/VPN/Cloudflare Access in front.

## 2. Scoring (server only, `functions/lib/scoring.js`)
- Base: points on each question (defaults easy 100 / medium 200 / hard 300).
- `speedBonus = floor(base × 0.25 × max(0, 1 − elapsed / budget))`, never above base. Only for correct answers.
- `elapsed` = server time of the answer − max(first time that question was shown, attempt start). `budget` = question `timeBudgetSeconds`, else `floor(duration / questionCount)` (min 5 s). Negative/invalid elapsed → bonus 0. Answers received after the deadline are ignored.
- Accuracy = correct / total questions. Breakdown per question is stored in the attempt (`scoring`).
- Status: `submitted`, `timed_out` (deadline reached, ≥1 answer), `abandoned` (deadline reached, no answers; not counted as completed or ranked).

## 3. Data model
`users` (profile/role, read-only to clients) · `exams` (metadata, status, `attemptCount`) · `examQuestions` (question text, no keys) · `examKeys` (keys, server only) · `attempts` (answers, deadline, result + `scoring`) · `attemptLocks` (server only) · `leaderboardSummaries/{user}` (all-time totals, updated in the finalize transaction) · `leaderboardEntries/{attempt}` (one small public row per completed attempt, used for week/month filters and public charts) · `activityLogs` (admin read only) · `pinSecrets` (server only).
Denormalized aggregates (`leaderboardSummaries`, `attemptCount`) change only inside the same transactions that create/finalize attempts.

**Privacy setting.** Public to all four users: leaderboard summary + per-attempt points/accuracy/time (`leaderboardEntries`). Private: attempt details, answers, review (own + admin). To make detailed results public you would loosen the `attempts` rule; it is deliberately not exposed by default. Note an attempt's stored `scoring` shows which questions were right, visible to its owner after finalization even if "show correct answers" is off (the actual key is never sent).

## 4. Setup
Prerequisites: Node 20+, `npm i -g firebase-tools`, a Google account. **Cloud Functions require the Blaze (pay-as-you-go) plan**; a four-person app should stay within or near free quotas, but costs are not guaranteed (Firestore reads/writes, function invocations, scheduler job, Hosting transfer). Set a budget alert.

1. Create a Firebase project at console.firebase.google.com; upgrade to Blaze.
2. Enable **Firestore** (production mode). **Authentication needs no provider**: custom tokens work without enabling one, but open Authentication once so the service is initialized.
3. `firebase login` then `firebase use --add` (pick the project).
4. Project settings → Your apps → Web app; paste the config into `public/js/firebase-config.js`.
5. Custom-token signing: in Google Cloud IAM, grant your functions' runtime service account (default: `<project-number>-compute@developer.gserviceaccount.com`) the role **Service Account Token Creator** on itself. Without it `loginWithPin` fails with a signBlob permission error.
6. `cp functions/.env.example functions/.env` and set `SETUP_CODE` (and `PIN_PEPPER`). Never commit it.
7. `cd functions && npm install && cd ..`
8. Deploy: `firebase deploy --only firestore,functions,hosting` (indexes can take a few minutes to build; admin log filters fail until then).
9. Users: there is no seeding step. Each person opens the site, taps their name, and sets a PIN (with the setup code). Roles come from code, so Abood is admin automatically, nobody else can be. To reset a forgotten PIN, delete the `pinSecrets/<user>` document in the console.
10. Local run: `firebase emulators:start`, set `USE_EMULATORS = true` in firebase-config.js, open http://localhost:5000.
11. Updating later: edit, then `firebase deploy` (or `--only hosting` / `--only functions`).

## 5. Importing exams from ChatGPT
Admin → Import JSON → copy the prompt, run it in ChatGPT yourself, paste the JSON, validate, review the highlighted correct answers, then *Import as draft* (or *Edit questions first*). The site never calls any AI API. All imported text is rendered with `textContent`, never `innerHTML`. Limits: 200 questions, 400,000 characters. Dates need a timezone offset (e.g. `+03:00`).

## 6. Testing
Executed during development (output shown in the final message): `npm --prefix functions test` (scoring + validation unit tests), syntax checks of every module, loading `functions/index.js` and listing its exports.

**Not executed here, you must run them:** `npm i && npm run test:rules` (Firestore Security Rules tests in `tests/rules.test.js`, needs Java + emulator), and the end-to-end checklist below with the emulators or a real project. The code has never run against a live Firebase project.

Manual acceptance checklist
- Each of the 4 users sets a PIN, signs out, signs in; wrong PIN is rejected and 5 wrong PINs lock.
- Loge cannot open `#/admin` (redirects) and Firestore reads of `examKeys`, `pinSecrets`, `activityLogs` fail from the browser console.
- Abood imports valid JSON (preview shows keys), bad JSON shows readable errors; publish, unpublish, duplicate, delete.
- Opening/closing dates are honoured; attempt limit stops the next attempt; refresh mid-exam keeps the timer; waiting out the timer finalizes; double submit gives the same score.
- Leaderboard ordering and tie-breakers, week/month filters; history/dashboard charts match stored attempts.
- Mobile (~360 px) and desktop layouts, dark mode, keyboard navigation.

## 7. Known limitations
- 4-digit PINs (see above). No App Check or per-IP rate limiting; consider enabling App Check.
- Editing an exam's questions while someone is mid-attempt may change how that in-progress attempt is scored (finished attempts are never re-scored).
- Week/month leaderboards are aggregated in the browser from `leaderboardEntries` (fine for 4 users).
- `answer_submitted` logs every answer change (more writes). The CSP in `firebase.json` is strict and untested against every Firebase SDK path; relax `connect-src` if the console shows blocked requests.
- Sweeper runs every 15 minutes, so an abandoned attempt can show as in progress for a short time after its deadline (it is finalized immediately whenever the user or admin opens it).

## Layout
`public/` static site (single-page app, hash routes) · `functions/` trusted backend + unit tests · `firestore.rules`, `firestore.indexes.json`, `firebase.json` · `tests/rules.test.js`.
