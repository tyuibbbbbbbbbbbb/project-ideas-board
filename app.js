import { auth, db } from "./firebase-config.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DOWNVOTE_REVIEW_THRESHOLD = 10;
const NAME_KEY = "pib_name";
const SAVED_KEY = "pib_saved"; // רעיונות שמורים - פרטיים לגמרי, נשמרים רק בדפדפן

// זהות: uid אנונימי מ-Firebase (יציב לדפדפן) + שם תצוגה שנבחר. ללא סיסמה.
let uid = null;
let displayName = localStorage.getItem(NAME_KEY) || null;

let allIdeas = [];
let savedIds = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"));
let activeFilter = "all";
let pendingAction = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const setNameBtn = $("setNameBtn");
const changeNameBtn = $("changeNameBtn");
const userBox = $("userBox");
const userName = $("userName");
const newIdeaBtn = $("newIdeaBtn");
const ideasGrid = $("ideasGrid");

const nameModal = $("nameModal");
const nameForm = $("nameForm");
const displayNameInput = $("displayNameInput");
const nameError = $("nameError");

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
[nameModal, ideaModal, detailModal].forEach((m) => {
  m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); });
});

// ---------- Auth (anonymous) + live data ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    uid = user.uid;
    renderIdeas();
  }
});
signInAnonymously(auth).catch((err) => {
  ideasGrid.innerHTML = `<div class="loading">שגיאת התחברות ל-Firebase: ${escapeHtml(err.message)}</div>`;
});

onSnapshot(collection(db, "ideas"), (snapshot) => {
  allIdeas = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderIdeas();
}, (err) => {
  ideasGrid.innerHTML = `<div class="loading">שגיאה בטעינת רעיונות: ${escapeHtml(err.message)}</div>`;
});

// ---------- Name / identity ----------
function requireName(afterFn) {
  if (displayName) { afterFn(); return; }
  pendingAction = afterFn;
  displayNameInput.value = "";
  nameError.classList.add("hidden");
  openModal(nameModal);
}

setNameBtn.addEventListener("click", () => { pendingAction = null; displayNameInput.value = ""; openModal(nameModal); });
changeNameBtn.addEventListener("click", () => { pendingAction = null; displayNameInput.value = displayName || ""; openModal(nameModal); });

nameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = displayNameInput.value.trim();
  if (!name) { nameError.textContent = "נא להזין שם"; nameError.classList.remove("hidden"); return; }
  displayName = name;
  localStorage.setItem(NAME_KEY, name);
  closeModal(nameModal);
  updateNameUI();
  renderIdeas();
  if (pendingAction) { const fn = pendingAction; pendingAction = null; fn(); }
});

function updateNameUI() {
  if (displayName) {
    setNameBtn.classList.add("hidden");
    userBox.classList.remove("hidden");
    userName.textContent = `שלום, ${displayName}`;
  } else {
    setNameBtn.classList.remove("hidden");
    userBox.classList.add("hidden");
    userName.textContent = "";
  }
}

// ---------- New idea ----------
newIdeaBtn.addEventListener("click", () => requireName(() => openModal(ideaModal)));

ideaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("ideaTitle").value.trim();
  const desc = $("ideaDesc").value.trim();
  const tag = $("ideaTag").value.trim();
  if (!title || !desc || !uid) return;

  try {
    await addDoc(collection(db, "ideas"), {
      title, desc,
      tag: tag || "כללי",
      authorUid: uid,
      authorName: displayName,
      createdAt: serverTimestamp(),
      upvotes: [], downvotes: [],
      status: "open",
      takenByUid: null, takenByName: null
    });
    ideaForm.reset();
    closeModal(ideaModal);
  } catch (err) {
    alert(err.message);
  }
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

// ---------- Rendering ----------
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

  const myUpvoted = uid && idea.upvotes?.includes(uid);
  const myDownvoted = uid && idea.downvotes?.includes(uid);
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
    if (uid && uid === idea.takenByUid) {
      return `<button class="finish-btn">ביצעתי את הפרויקט &#9989;</button>`;
    }
    return `<span class="taken-badge">נלקח ע"י ${escapeHtml(idea.takenByName || "מפתח")}</span>`;
  }
  return `<button class="claim-btn">יאללה עלי! &#128640;</button>`;
}

// ---------- Actions ----------
function vote(idea, direction) {
  requireName(async () => {
    if (!uid) return;
    const ref = doc(db, "ideas", idea.id);
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
    try { await updateDoc(ref, updates); } catch (err) { alert(err.message); }
  });
}

function claimIdea(idea) {
  requireName(async () => {
    if (!uid) return;
    if (idea.authorUid === uid) { alert("אתה לא יכול לאמץ את הרעיון של עצמך :)"); return; }
    try {
      await updateDoc(doc(db, "ideas", idea.id), {
        status: "taken",
        takenByUid: uid,
        takenByName: displayName
      });
    } catch (err) { alert(err.message); }
  });
}

function finishIdea(idea) {
  requireName(async () => {
    if (!uid || uid !== idea.takenByUid) return;
    try {
      await updateDoc(doc(db, "ideas", idea.id), { status: "done" });
    } catch (err) { alert(err.message); }
  });
}

// שמירה "לעצמי" - פרטית לגמרי, נשמרת רק בדפדפן הזה
function toggleSave(ideaId) {
  if (savedIds.has(ideaId)) savedIds.delete(ideaId);
  else savedIds.add(ideaId);
  localStorage.setItem(SAVED_KEY, JSON.stringify([...savedIds]));
  renderIdeas();
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

// ---------- Init ----------
updateNameUI();
