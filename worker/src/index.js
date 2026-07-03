// ============================================================================
// Cloudflare Worker - "מתווך" מאובטח בין האתר (GitHub Pages) לבין
// מסד הנתונים שנשמר כקבצי JSON בריפו פרטי בגיטהאב (project-ideas-data).
//
// הוא מחזיק בסוד את ה-GitHub Token ואת מפתח החתימה של ה-Sessions,
// כדי שהם לעולם לא ייחשפו בקוד הציבורי של האתר.
// ============================================================================

const GITHUB_API = "https://api.github.com";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 יום
const DOWNVOTE_REVIEW_THRESHOLD = 10;

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/register" && request.method === "POST") return withCors(await handleRegister(request, env), cors);
      if (path === "/api/login" && request.method === "POST") return withCors(await handleLogin(request, env), cors);
      if (path === "/api/ideas" && request.method === "GET") return withCors(await handleGetIdeas(env), cors);
      if (path === "/api/ideas" && request.method === "POST") return withCors(await handleCreateIdea(request, env), cors);
      if (path === "/api/vote" && request.method === "POST") return withCors(await handleVote(request, env), cors);
      if (path === "/api/claim" && request.method === "POST") return withCors(await handleClaim(request, env), cors);
      if (path === "/api/finish" && request.method === "POST") return withCors(await handleFinish(request, env), cors);
      if (path === "/api/saved" && request.method === "GET") return withCors(await handleGetSaved(request, env), cors);
      if (path === "/api/saved" && request.method === "POST") return withCors(await handleToggleSaved(request, env), cors);

      return withCors(json({ error: "לא נמצא" }, 404), cors);
    } catch (err) {
      return withCors(json({ error: err.message || "שגיאת שרת" }, 500), cors);
    }
  }
};

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function withCors(response, cors) {
  const headers = new Headers(response.headers);
  Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, { status: response.status, headers });
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

// ---------------------------------------------------------------------------
// GitHub Contents API helpers (קריאה/כתיבה של קבצי JSON בריפו הפרטי)
// ---------------------------------------------------------------------------
async function ghRequest(env, method, path, body) {
  const res = await fetch(`${GITHUB_API}/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "project-ideas-worker",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}

async function readJsonFile(env, path) {
  const res = await ghRequest(env, "GET", `${path}?ref=${env.DATA_BRANCH}`);
  if (!res.ok) throw new Error(`לא ניתן לקרוא ${path} (${res.status})`);
  const data = await res.json();
  const content = decodeBase64Utf8(data.content);
  return { data: JSON.parse(content), sha: data.sha };
}

async function writeJsonFile(env, path, dataObj, sha, message) {
  const content = encodeUtf8Base64(JSON.stringify(dataObj, null, 2));
  const res = await ghRequest(env, "PUT", path, {
    message,
    content,
    sha,
    branch: env.DATA_BRANCH
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`שגיאה בשמירת ${path}: ${res.status} ${errBody}`);
  }
  return res.json();
}

// עדכון עם ניסיון חוזר (retry) למקרה של קונפליקט כתיבה בו-זמנית
// updateFn יכולה להיות סינכרונית או אסינכרונית, ומחזירה { data, result }
async function updateJsonFile(env, path, updateFn, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readJsonFile(env, path);
    const updated = await updateFn(data);
    try {
      await writeJsonFile(env, path, updated.data, sha, message);
      return updated.result;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
function encodeUtf8Base64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// סיסמאות - PBKDF2 (Web Crypto, זמין ב-Workers)
// ---------------------------------------------------------------------------
async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// טוקן התחברות (JWT-lite חתום ב-HMAC-SHA256)
// ---------------------------------------------------------------------------
async function signToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64urlFromBytes(new Uint8Array(sig))}`;
}

async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, sig] = parts;
  const data = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, base64urlToBytes(sig), new TextEncoder().encode(data));
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(encPayload)));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function base64url(str) { return base64urlFromBytes(new TextEncoder().encode(str)); }
function base64urlFromBytes(bytes) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, "=");
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("נדרשת התחברות");
  const payload = await verifyToken(token, env.JWT_SECRET);
  if (!payload) throw new Error("ההתחברות פגה, נא להתחבר מחדש");
  return payload; // { uid, email, fullName, username, exp }
}

// ---------------------------------------------------------------------------
// Handlers - Auth
// ---------------------------------------------------------------------------
async function handleRegister(request, env) {
  const body = await request.json();
  const fullName = (body.fullName || "").trim();
  const username = (body.username || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!fullName || !username) return json({ error: "נא למלא שם מלא ושם משתמש בפורום" }, 400);
  if (!email || !email.includes("@")) return json({ error: "אימייל לא תקין" }, 400);
  if (password.length < 6) return json({ error: "הסיסמה חלשה מדי (מינימום 6 תווים)" }, 400);

  const newUser = await updateJsonFile(env, "data/users.json", async (users) => {
    if (users.some((u) => u.email === email)) {
      throw new Error("האימייל הזה כבר רשום במערכת");
    }
    return hashAndBuildUser(fullName, username, email, password, users);
  }, `New user registration: ${username}`);

  const token = await signToken(
    { uid: newUser.uid, email, fullName, username, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS },
    env.JWT_SECRET
  );
  return json({ token, profile: { uid: newUser.uid, fullName, username, email } });
}

// הפונקציה הזו סינכרונית לוגית אבל צריכה hash אסינכרוני - לכן updateJsonFile
// מקבלת async updateFn; מתקנים כאן בהתאם.
async function hashAndBuildUser(fullName, username, email, password, users) {
  const { hash, salt } = await hashPassword(password);
  const uid = crypto.randomUUID();
  const user = { uid, fullName, username, email, passwordHash: hash, salt, savedIds: [], createdAt: Date.now() };
  return { data: [...users, user], result: user };
}

async function handleLogin(request, env) {
  const body = await request.json();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  const { data: users } = await readJsonFile(env, "data/users.json");
  const user = users.find((u) => u.email === email);
  if (!user) return json({ error: "אימייל או סיסמה שגויים" }, 401);

  const { hash } = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) return json({ error: "אימייל או סיסמה שגויים" }, 401);

  const token = await signToken(
    { uid: user.uid, email: user.email, fullName: user.fullName, username: user.username, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS },
    env.JWT_SECRET
  );
  return json({ token, profile: { uid: user.uid, fullName: user.fullName, username: user.username, email: user.email } });
}

// ---------------------------------------------------------------------------
// Handlers - Ideas
// ---------------------------------------------------------------------------
async function handleGetIdeas(env) {
  const { data } = await readJsonFile(env, "data/ideas.json");
  return json({ ideas: data });
}

async function handleCreateIdea(request, env) {
  const user = await requireAuth(request, env);
  const body = await request.json();
  const title = (body.title || "").trim();
  const desc = (body.desc || "").trim();
  const tag = (body.tag || "כללי").trim();
  if (!title || !desc) return json({ error: "נא למלא כותרת ותיאור" }, 400);

  const idea = await updateJsonFile(env, "data/ideas.json", (ideas) => {
    const newIdea = {
      id: crypto.randomUUID(),
      title, desc, tag,
      authorUid: user.uid,
      authorName: user.fullName || user.username,
      createdAt: Date.now(),
      upvotes: [], downvotes: [],
      status: "open",
      takenByUid: null, takenByName: null
    };
    return { data: [...ideas, newIdea], result: newIdea };
  }, `New idea: ${title}`);

  return json({ idea });
}

async function handleVote(request, env) {
  const user = await requireAuth(request, env);
  const { ideaId, direction } = await request.json();
  if (!["up", "down"].includes(direction)) return json({ error: "כיוון הצבעה לא תקין" }, 400);

  const idea = await updateJsonFile(env, "data/ideas.json", (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    const upSet = new Set(target.upvotes);
    const downSet = new Set(target.downvotes);
    if (direction === "up") {
      upSet.has(user.uid) ? upSet.delete(user.uid) : upSet.add(user.uid);
      downSet.delete(user.uid);
    } else {
      downSet.has(user.uid) ? downSet.delete(user.uid) : downSet.add(user.uid);
      upSet.delete(user.uid);
    }
    target.upvotes = [...upSet];
    target.downvotes = [...downSet];
    const updated = [...ideas];
    updated[idx] = target;
    return { data: updated, result: target };
  }, `Vote on idea ${ideaId}`);

  return json({ idea });
}

async function handleClaim(request, env) {
  const user = await requireAuth(request, env);
  const { ideaId } = await request.json();

  const idea = await updateJsonFile(env, "data/ideas.json", (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    if (target.authorUid === user.uid) throw new Error("אתה לא יכול לאמץ את הרעיון של עצמך");
    if (target.status !== "open") throw new Error("הרעיון כבר נלקח");
    target.status = "taken";
    target.takenByUid = user.uid;
    target.takenByName = user.fullName || user.username;
    const updated = [...ideas];
    updated[idx] = target;
    return { data: updated, result: target };
  }, `Claim idea ${ideaId}`);

  return json({ idea });
}

async function handleFinish(request, env) {
  const user = await requireAuth(request, env);
  const { ideaId } = await request.json();

  const idea = await updateJsonFile(env, "data/ideas.json", (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    if (target.takenByUid !== user.uid) throw new Error("רק מי שאימץ את הרעיון יכול לסמן אותו כבוצע");
    target.status = "done";
    const updated = [...ideas];
    updated[idx] = target;
    return { data: updated, result: target };
  }, `Finish idea ${ideaId}`);

  return json({ idea });
}

// ---------------------------------------------------------------------------
// Handlers - Saved ideas (פרטי, נשמר תחת המשתמש)
// ---------------------------------------------------------------------------
async function handleGetSaved(request, env) {
  const user = await requireAuth(request, env);
  const { data: users } = await readJsonFile(env, "data/users.json");
  const me = users.find((u) => u.uid === user.uid);
  return json({ savedIds: me?.savedIds || [] });
}

async function handleToggleSaved(request, env) {
  const user = await requireAuth(request, env);
  const { ideaId } = await request.json();

  const result = await updateJsonFile(env, "data/users.json", (users) => {
    const idx = users.findIndex((u) => u.uid === user.uid);
    if (idx === -1) throw new Error("משתמש לא נמצא");
    const target = { ...users[idx] };
    const savedSet = new Set(target.savedIds || []);
    const nowSaved = !savedSet.has(ideaId);
    nowSaved ? savedSet.add(ideaId) : savedSet.delete(ideaId);
    target.savedIds = [...savedSet];
    const updated = [...users];
    updated[idx] = target;
    return { data: updated, result: { saved: nowSaved, savedIds: target.savedIds } };
  }, `Toggle saved idea ${ideaId} for ${user.uid}`);

  return json(result);
}
