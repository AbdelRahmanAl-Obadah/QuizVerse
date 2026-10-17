import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, connectAuthEmulator, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import * as FS from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, USE_EMULATORS } from './firebase-config.js';

export const configured = !firebaseConfig.apiKey.startsWith('YOUR_');
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app && getAuth(app);
export const db = app && FS.getFirestore(app);
if (app && USE_EMULATORS && location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  FS.connectFirestoreEmulator(db, 'localhost', 8080);
}
export { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider };
export const { collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, orderBy, limit, startAfter, getCountFromServer, serverTimestamp, Timestamp } = FS;
