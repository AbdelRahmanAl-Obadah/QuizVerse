// Paste the Firebase *web app* config for project abood-cv (Project settings > Your apps). It is not a secret;
// security comes from Firebase Auth + Firestore Security Rules, not from hiding this file.
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'abood-cv.firebaseapp.com',
  projectId: 'abood-cv',
  appId: 'YOUR_APP_ID',
};
export const USE_EMULATORS = false; // true when running `firebase emulators:start` on localhost
export const ACCOUNT_DOMAIN = 'quizverse.app'; // synthetic e-mail domain for the four accounts (abood@, loge@, jana@, kinda@)
