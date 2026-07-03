import { WORKER_URL } from "./config.js";

const DOWNVOTE_REVIEW_THRESHOLD = 10;
const POLL_INTERVAL_MS = 15000;
const TOKEN_KEY = "pib_token";
const PROFILE_KEY = "pib_profile";

let currentToken = localStorage.getItem(TOKEN_KEY) || null;
let currentProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
let allIdeas = [];
let savedIds = new Set();
let activeFilter = "all";

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
const authSwitchText = $("authSwitchText");
const authSwitchLink = $("authSwitchLink");
let authMode = "login";

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

// ---------- API helper ----------
async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    if (!currentToken) throw new Error("נדרשת התחברות");
    headers.Authorization = `Bearer ${currentToken}`;
  }
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "אירעה שגיאה, נסה שוב");
  return data;
}

// ---------- Auth UI ----------
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

loginBtn.addEventListener("click", () => { setAuthMode("login"); openModal(authModal); });
registerBtn.addEventListener("click", () => { setAuthMode("register"); openModal(authModal); });
authSwitchLink.addEventListener("click", (e) => { e.preventDefault(); setAuthMode(authMode === "login" ? "register" : "login"); });

logoutBtn.addEventListener("click", () => {
  currentToken = null;
  currentProfile = null;
  savedIds = new Set();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  updateAuthUI();
  renderIdeas();
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  try {
    let result;
    if (authMode === "register") {
      const fullName = $("fullName").value.trim();
      const username = $("forumUsername").value.trim();
      result = await api("/api/register", { method: "POST", body: { fullName, username, email, password } });
    } else {
      result = await api("/api/login", { method: "POST", body: { email, password } });
    }
    currentToken = result.token;
    currentProfile = result.profile;
    localStorage.setItem(TOKEN_KEY, currentToken);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(currentProfile));
    authForm.reset();
    closeModal(authModal);
    updateAuthUI();
    await loadSaved();
    renderIdeas();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove("hidden");
  }
});

function updateAuthUI() {
  if (currentProfile) {
    loginBtn.classList.add("hidden");
    registerBtn.classList.add("hidden");
    userBox.classList.remove("hidden");
    userName.textContent = `שלום, ${currentProfile.fullName || currentProfile.username}`;
  } else {
    loginBtn.classList.remove("hidden");
    registerBtn.classList.remove("hidden");
    userBox.classList.add("hidden");
    userName.textContent = "";
  }
}

// ---------- New idea ----------
newIdeaBtn.addEventListener("click", () => {
  if (!currentToken) { openModal(authModal); return; }
  openModal(ideaModal);
});

ideaForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("ideaTitle").value.trim();
  const desc = $("ideaDesc").value.trim();
  const tag = $("ideaTag").value.trim();
  if (!title || !desc) return;

  try {
    await api("/api/ideas", { method: "POST", auth: true, body: { title, desc, tag } });
    ideaForm.reset();
    closeModal(ideaModal);
    await loadIdeas();
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

// ---------- Data loading ----------
async function loadIdeas() {
  try {
    const { ideas } = await api("/api/ideas");
    allIdeas = ideas;
    renderIdeas();
  } catch (err) {
    ideasGrid.innerHTML = `<div class="loading">שגיאה בטעינת רעיונות: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadSaved() {
  if (!currentToken) { savedIds = new Set(); return; }
  try {
    const { savedIds: ids } = await api("/api/saved", { auth: true });
    savedIds = new Set(ids);
  } catch {
    savedIds = new Set();
  }
}

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

  if (activeFilter === "saved" && !currentToken) {
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

  const myUid = currentProfile?.uid;
  const myUpvoted = myUid && idea.upvotes?.includes(myUid);
  const myDownvoted = myUid && idea.downvotes?.includes(myUid);
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
    if (currentProfile && currentProfile.uid === idea.takenByUid) {
      return `<button class="finish-btn">ביצעתי את הפרויקט &#9989;</button>`;
    }
    return `<span class="taken-badge">נלקח ע"י ${escapeHtml(idea.takenByName || "מפתח")}</span>`;
  }
  return `<button class="claim-btn">יאללה עלי! &#128640;</button>`;
}

// ---------- Actions ----------
async function vote(idea, direction) {
  if (!currentToken) { openModal(authModal); return; }
  try {
    const { idea: updated } = await api("/api/vote", { method: "POST", auth: true, body: { ideaId: idea.id, direction } });
    applyIdeaUpdate(updated);
  } catch (err) {
    alert(err.message);
  }
}

async function claimIdea(idea) {
  if (!currentToken) { openModal(authModal); return; }
  try {
    const { idea: updated } = await api("/api/claim", { method: "POST", auth: true, body: { ideaId: idea.id } });
    applyIdeaUpdate(updated);
  } catch (err) {
    alert(err.message);
  }
}

async function finishIdea(idea) {
  if (!currentToken) return;
  try {
    const { idea: updated } = await api("/api/finish", { method: "POST", auth: true, body: { ideaId: idea.id } });
    applyIdeaUpdate(updated);
  } catch (err) {
    alert(err.message);
  }
}

async function toggleSave(ideaId) {
  if (!currentToken) { openModal(authModal); return; }
  try {
    const { saved } = await api("/api/saved", { method: "POST", auth: true, body: { ideaId } });
    if (saved) savedIds.add(ideaId); else savedIds.delete(ideaId);
    renderIdeas();
  } catch (err) {
    alert(err.message);
  }
}

function applyIdeaUpdate(updatedIdea) {
  const idx = allIdeas.findIndex((i) => i.id === updatedIdea.id);
  if (idx !== -1) allIdeas[idx] = updatedIdea;
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
updateAuthUI();
loadSaved().then(renderIdeas);
loadIdeas();
setInterval(loadIdeas, POLL_INTERVAL_MS);
