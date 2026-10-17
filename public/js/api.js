import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import * as FS from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { firebaseConfig, FUNCTIONS_REGION, USE_EMULATORS } from './firebase-config.js';

export const configured = !firebaseConfig.apiKey.startsWith('YOUR_');
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app && getAuth(app);
export const db = app && FS.getFirestore(app);
const functions = app && getFunctions(app, FUNCTIONS_REGION);
if (app && USE_EMULATORS && location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  FS.connectFirestoreEmulator(db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}
export { signInWithCustomToken, signOut, onAuthStateChanged };
export const { collection, doc, getDoc, getDocs, query, where, orderBy, limit, startAfter, getCountFromServer } = FS;

/** Call a trusted Cloud Function. Errors keep a plain `code` and `details`. */
export async function fn(name, data = {}) {
  try { return (await httpsCallable(functions, name)(data)).data; }
  catch (e) {
    const err = new Error(e.message || 'Request failed');
    err.code = String(e.code || '').replace('functions/', '');
    err.details = e.details;
    if (err.code === 'internal' || err.code === 'unavailable') err.message = 'Network or server problem. Check your connection and try again.';
    throw err;
  }
}
