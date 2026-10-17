// Paste your Firebase *web app* config here (Project settings > Your apps). It is not a secret;
// security comes from Firestore rules + Cloud Functions.
export const firebaseConfig = {
apiKey: "AIzaSyAPs66eFLx1Ad88pt06eVs22Wtoh3fX8fQ",
  authDomain: "abood-cv.firebaseapp.com",
  databaseURL: "https://abood-cv-default-rtdb.firebaseio.com",
  projectId: "abood-cv",
  storageBucket: "abood-cv.firebasestorage.app",
  messagingSenderId: "850175667055",
  appId: "1:850175667055:web:df56a8babe8ed08b2a569a"
};
export const FUNCTIONS_REGION = 'us-central1';
export const USE_EMULATORS = false; // true when running `firebase emulators:start` on localhost
