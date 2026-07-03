import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DOWNVOTE_REVIEW_THRESHOLD = 10;

let currentUser = null;   // firebase auth user
let currentProfile = null; // { fullName, username }
let allIdeas = [];
let activeFilter = "all";
let savedIds = new Set();
let unsubSaved = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const loginBtn = $("loginBtn");
const registerBtn = $("registerBtn");
const userBox = $("userBox");
const userName = $("userName");
const logoutBtn = $("logoutBtn");
const newIdeaBtn = $("newIdeaBtn");
const ideasGrid = $("ideasGrid");

const authModal = $("authModal");
const authModalTitle = $("authModalTitle");
const authForm = $("authForm");
const registerFields = $("registerFields");
const authSubmitBtn = $("authSubmitBtn");
const authError = $("authError");
let authMode = "login";

const authSwitchText = $("authSwitchText");
const authSwitchLink = $("authSwitchLink");

const ideaModal = $("ideaModal");
const ideaForm = $("ideaForm");

const detailModal = $("detailModal");
const detailContent = $("detailContent");

// ---------- Modal helpers ----------
function openModal(el) { el.classList.remove("hidden"); }
function closeModal(el) { el.classList.add("hidden"); }

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal($(btn.dataset.close)));
});
[authModal, ideaModal, detailModal].forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); });
});

// ---------- Auth ----------
function setAuthMode(mode) {
  authMode = mode;
  authForm.reset();
  authError.classList.add("hidden");
  if (mode === "register") {
    authModalTitle.textContent = "הרשמה";
    authSubmitBtn.textContent = "הרשם";
    registerFields.classList.remove("hidden");
    authSwitchText.textContent = "יש לך כבר חשבון?";
    authSwitchLink.textContent = "התחבר עכשיו";
  } else {
    authModalTitle.textContent = "התחברות";
    authSubmitBtn.textContent = "התחבר";
    registerFields.classList.add("hidden");
    authSwitchText.textContent = "אין לך חשבון?";
    authSwitchLink.textContent = "הרשם עכשיו";
  }
}

loginBtn.addEventListener("click", () => {
  setAuthMode("login");
  openModal(authModal);
});

registerBtn.addEventListener("click", () => {
  setAuthMode("register");
  openModal(authModal);
});

authSwitchLink.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(authMode === "login" ? "register" : "login");
});

logoutBtn.addEventListener("click", () => signOut(auth));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  try {
    if (authMode === "register") {
      const fullName = $("fullName").value.trim();
      const username = $("forumUsername").value.trim();
      if (!fullName || !username) {
        throw new Error("נא למלא שם מלא ושם משתמש בפורום");
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        fullName,
        username,
        email,
        createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    authForm.reset();
    closeModal(authModal);
  } catch (err) {
    authError.textContent = translateError(err);
    authError.classList.remove("hidden");
  }
});

function translateError(err) {
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "האימייל הזה כבר רשום במערכת";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "אימייל או סיסמה שגויים";
  if (code.includes("weak-password")) return "הסיסמה חלשה מדי (מינימום 6 תווים)";
  return err.message || "אירעה שגיאה, נסה שוב";
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (unsubSaved) { unsubSaved(); unsubSaved = null; }
  savedIds = new Set();

  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    currentProfile = snap.exists() ? snap.data() : { fullName: user.email, username: "" };
    loginBtn.classList.add("hidden");
    registerBtn.classList.add("hidden");
    userBox.classList.remove("hidden");
    userName.textContent = `שלום, ${currentProfile.fullName || currentProfile.username}`;

    unsubSaved = onSnapshot(collection(db, "users", user.uid, "saved"), (snapshot) => {
      savedIds = new Set(snapshot.docs.map((d) => d.id));
      renderIdeas();
    });
  } else {
    currentProfile = null;
    loginBtn.classList.remove("hidden");
    registerBtn.classList.remove("hidden");
    userBox.classList.add("hidden");
    userName.textContent = "";
  }
  renderIdeas();
});

// ---------- New idea ----------
newIdeaBtn.addEventListener("click", () => {
  if (!currentUser) {
    openModal(authModal);
    return;
  }
  openModal(ideaModal);
});

ideaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("ideaTitle").value.trim();
  const desc = $("ideaDesc").value.trim();
  const tag = $("ideaTag").value.trim();
  if (!title || !desc) return;

  await addDoc(collection(db, "ideas"), {
    title,
    desc,
    tag: tag || "כללי",
    authorUid: currentUser.uid,
    authorName: currentProfile.fullName || currentProfile.username,
    createdAt: serverTimestamp(),
    upvotes: [],
    downvotes: [],
    status: "open",
    takenByUid: null,
    takenByName: null
  });

  ideaForm.reset();
  closeModal(ideaModal);
});

// ---------- Filters ----------
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderIdeas();
  });
});

// ---------- Firestore live data ----------
onSnapshot(collection(db, "ideas"), (snapshot) => {
  allIdeas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderIdeas();
});

function scoreOf(idea) {
  return (idea.upvotes?.length || 0) - (idea.downvotes?.length || 0);
}

function statusOf(idea) {
  if ((idea.downvotes?.length || 0) > DOWNVOTE_REVIEW_THRESHOLD) return "review";
  return idea.status || "open";
}

function renderIdeas() {
  let list = [...allIdeas];

  list = list.filter((idea) => {
    const st = statusOf(idea);
    if (activeFilter === "open") return st === "open";
    if (activeFilter === "taken") return st === "taken";
    if (activeFilter === "done") return st === "done";
    if (activeFilter === "saved") return savedIds.has(idea.id);
    return true;
  });

  list.sort((a, b) => scoreOf(b) - scoreOf(a));

  if (activeFilter === "saved" && !currentUser) {
    ideasGrid.innerHTML = `<div class="loading">התחבר כדי לראות את הרעיונות השמורים שלך.</div>`;
    return;
  }

  if (list.length === 0) {
    ideasGrid.innerHTML = `<div class="loading">אין רעיונות להצגה כרגע. תהיה הראשון לפרסם!</div>`;
    return;
  }

  ideasGrid.innerHTML = "";
  list.forEach((idea) => ideasGrid.appendChild(buildCard(idea)));
}

function buildCard(idea) {
  const st = statusOf(idea);
  const card = document.createElement("div");
  card.className = "idea-card" + (st === "taken" ? " taken" : "") + (st === "done" ? " done" : "");

  const myUpvoted = currentUser && idea.upvotes?.includes(currentUser.uid);
  const myDownvoted = currentUser && idea.downvotes?.includes(currentUser.uid);
  const isSaved = savedIds.has(idea.id);

  card.innerHTML = `
    <div class="card-top-row">
      <span class="idea-tag">${escapeHtml(idea.tag || "כללי")}</span>
      <button class="save-btn ${isSaved ? "active" : ""}" title="שמור לעצמי">${isSaved ? "&#9733;" : "&#9734;"}</button>
    </div>
    <h3 class="idea-title">${escapeHtml(idea.title)}</h3>
    <p class="idea-desc">${escapeHtml(idea.desc)}</p>
    <div class="idea-meta">
      <div class="vote-controls">
        <button class="vote-btn up ${myUpvoted ? "active" : ""}" title="לייק">&#9650;</button>
        <span class="vote-score">${scoreOf(idea)}</span>
        <button class="vote-btn down ${myDownvoted ? "active" : ""}" title="דיסלייק">&#9660;</button>
      </div>
      ${badgeOrClaimHtml(idea, st)}
    </div>
  `;

  card.querySelector(".idea-title").addEventListener("click", () => showDetail(idea));
  card.querySelector(".vote-btn.up").addEventListener("click", () => vote(idea, "up"));
  card.querySelector(".vote-btn.down").addEventListener("click", () => vote(idea, "down"));
  card.querySelector(".save-btn").addEventListener("click", () => toggleSave(idea.id));
  const claimBtn = card.querySelector(".claim-btn");
  if (claimBtn) claimBtn.addEventListener("click", () => claimIdea(idea));
  const finishBtn = card.querySelector(".finish-btn");
  if (finishBtn) finishBtn.addEventListener("click", () => finishIdea(idea));

  return card;
}

function badgeOrClaimHtml(idea, st) {
  if (st === "review") {
    return `<span class="review-badge">בבדיקה &#9888;</span>`;
  }
  if (st === "done") {
    return `<span class="done-badge">בוצע &#9989; (ע"י ${escapeHtml(idea.takenByName || "מפתח")})</span>`;
  }
  if (st === "taken") {
    if (currentUser && currentUser.uid === idea.takenByUid) {
      return `<button class="finish-btn">ביצעתי את הפרויקט &#9989;</button>`;
    }
    return `<span class="taken-badge">נלקח ע"י ${escapeHtml(idea.takenByName || "מפתח")}</span>`;
  }
  return `<button class="claim-btn">יאללה עלי! &#128640;</button>`;
}

async function toggleSave(ideaId) {
  if (!currentUser) { openModal(authModal); return; }
  const ref = doc(db, "users", currentUser.uid, "saved", ideaId);
  if (savedIds.has(ideaId)) {
    await deleteDoc(ref);
  } else {
    await setDoc(ref, { savedAt: serverTimestamp() });
  }
}

async function vote(idea, direction) {
  if (!currentUser) { openModal(authModal); return; }
  const ref = doc(db, "ideas", idea.id);
  const uid = currentUser.uid;
  const upvoted = idea.upvotes?.includes(uid);
  const downvoted = idea.downvotes?.includes(uid);

  const updates = {};
  if (direction === "up") {
    updates.upvotes = upvoted ? arrayRemove(uid) : arrayUnion(uid);
    if (downvoted) updates.downvotes = arrayRemove(uid);
  } else {
    updates.downvotes = downvoted ? arrayRemove(uid) : arrayUnion(uid);
    if (upvoted) updates.upvotes = arrayRemove(uid);
  }
  await updateDoc(ref, updates);
}

async function claimIdea(idea) {
  if (!currentUser) { openModal(authModal); return; }
  if (idea.authorUid === currentUser.uid) {
    alert("אתה לא יכול לאמץ את הרעיון של עצמך :)");
    return;
  }
  const ref = doc(db, "ideas", idea.id);
  await updateDoc(ref, {
    status: "taken",
    takenByUid: currentUser.uid,
    takenByName: currentProfile.fullName || currentProfile.username
  });
}

async function finishIdea(idea) {
  if (!currentUser || currentUser.uid !== idea.takenByUid) return;
  const ref = doc(db, "ideas", idea.id);
  await updateDoc(ref, { status: "done" });
}

function showDetail(idea) {
  const st = statusOf(idea);
  detailContent.innerHTML = `
    <span class="idea-tag">${escapeHtml(idea.tag || "כללי")}</span>
    <h2>${escapeHtml(idea.title)}</h2>
    <div class="idea-author">פורסם ע"י ${escapeHtml(idea.authorName || "אנונימי")}</div>
    <p class="idea-desc">${escapeHtml(idea.desc)}</p>
    <div class="idea-meta">
      <div class="vote-score">ניקוד: ${scoreOf(idea)} (${idea.upvotes?.length || 0} לייקים / ${idea.downvotes?.length || 0} דיסלייקים)</div>
      ${badgeOrClaimHtml(idea, st)}
    </div>
  `;
  const claimBtn = detailContent.querySelector(".claim-btn");
  if (claimBtn) claimBtn.addEventListener("click", () => { claimIdea(idea); closeModal(detailModal); });
  const finishBtn = detailContent.querySelector(".finish-btn");
  if (finishBtn) finishBtn.addEventListener("click", () => { finishIdea(idea); closeModal(detailModal); });
  openModal(detailModal);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
