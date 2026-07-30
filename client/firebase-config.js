// Módulo de configuración e inicialización de Firebase para Mi Phone HN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  initializeFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAuPvcVYpvnA-h-7AbS6iWsYT2mibjQXDI",
  authDomain: "mi-phone-hn.firebaseapp.com",
  projectId: "mi-phone-hn",
  storageBucket: "mi-phone-hn.firebasestorage.app",
  messagingSenderId: "266992657565",
  appId: "1:266992657565:web:c95c45dbfb18c3eb832074",
  measurementId: "G-M8TN2JJS5L"
};

const app = initializeApp(firebaseConfig);

// Configuración explícita para forzar Long-Polling y evitar bloqueos por AdBlockers / WebChannel (ERR_BLOCKED_BY_CLIENT)
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

const storage = getStorage(app);
const auth = getAuth(app);

export { 
  app, 
  db, 
  storage, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  ref, 
  uploadBytes, 
  getDownloadURL,
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
};

export async function syncUserToFirestore(user) {
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        role: 'admin',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      });
      console.log("✅ Colección de usuarios creada en Firestore:", user.email);
    } else {
      await setDoc(userRef, { lastLogin: new Date().toISOString() }, { merge: true });
      console.log("✅ Usuario actualizado en Firestore:", user.email);
    }
    return true;
  } catch (err) {
    console.error("Error al registrar usuario en Firestore:", err);
    throw err;
  }
}
