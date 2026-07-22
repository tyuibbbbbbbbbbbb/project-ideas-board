// ============================================================
// הגדרות Firebase - החליפו את הערכים למטה בערכים מהפרויקט שלכם
// (Firebase Console -> Project settings -> Your apps -> Web app -> Config)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDs-EhWYlreyW_H-gui180KEdlhFHqm6H8",
  authDomain: "prujact.firebaseapp.com",
  projectId: "prujact",
  storageBucket: "prujact.firebasestorage.app",
  messagingSenderId: "564958849421",
  appId: "1:564958849421:web:3773e177b71186444bf5c4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, { experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: true });
