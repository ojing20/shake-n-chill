// ============================================================
//  Firebase Configuration – Shake 'n Chill
//  Project: shake-n-chill-df525
// ============================================================
const firebaseConfig = {
  apiKey:            "AIzaSyA_ybgkxW_rKco4D6RAoMWupzN24yhD2ps",
  authDomain:        "shake-n-chill-df525.firebaseapp.com",
  projectId:         "shake-n-chill-df525",
  storageBucket:     "shake-n-chill-df525.firebasestorage.app",
  messagingSenderId: "187780009353",
  appId:             "1:187780009353:web:8c1d94236b27527dd7a558",
  measurementId:     "G-XH1KJF855D"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db   = firebase.firestore();

// ─── Firestore offline persistence ────────────────────────
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
