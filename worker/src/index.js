// ============================================================================
// Cloudflare Worker - "מתווך" מאובטח בין האתר (GitHub Pages) לבין
// מסד הנתונים שנשמר כקובץ JSON בריפו הפרטי (project-ideas-data).
//
// גרסה ללא סיסמאות: כל אחד כותב שם תצוגה ומפרסם/מצביע.
// לכל דפדפן יש מזהה אקראי (uid) שנשלח בגוף הבקשה, כדי למנוע הצבעה כפולה
// ולזהות מי אימץ פרויקט. אין התחברות ואין נתונים אישיים רגישים.
//
// ה-Worker מחזיק בסוד את ה-GitHub Token, כדי שהוא לעולם לא ייחשף באתר.
// ============================================================================

const GITHUB_API = "https://api.github.com";
const IDEAS_PATH = "data/ideas.json";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/ideas" && request.method === "GET") return withCors(await handleGetIdeas(env), cors);
      if (path === "/api/ideas" && request.method === "POST") return withCors(await handleCreateIdea(request, env), cors);
      if (path === "/api/vote" && request.method === "POST") return withCors(await handleVote(request, env), cors);
      if (path === "/api/claim" && request.method === "POST") return withCors(await handleClaim(request, env), cors);
      if (path === "/api/finish" && request.method === "POST") return withCors(await handleFinish(request, env), cors);

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
    "Access-Control-Allow-Headers": "Content-Type",
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
// GitHub Contents API helpers
// ---------------------------------------------------------------------------
async function ghRequest(env, method, path, body) {
  return fetch(`${GITHUB_API}/repos/${env.DATA_OWNER}/${env.DATA_REPO}/contents/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "project-ideas-worker",
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function readIdeas(env) {
  const res = await ghRequest(env, "GET", `${IDEAS_PATH}?ref=${env.DATA_BRANCH}`);
  if (!res.ok) throw new Error(`לא ניתן לקרוא את הרעיונות (${res.status})`);
  const data = await res.json();
  return { ideas: JSON.parse(decodeBase64Utf8(data.content)), sha: data.sha };
}

async function writeIdeas(env, ideas, sha, message) {
  const content = encodeUtf8Base64(JSON.stringify(ideas, null, 2));
  const res = await ghRequest(env, "PUT", IDEAS_PATH, { message, content, sha, branch: env.DATA_BRANCH });
  if (!res.ok) throw new Error(`שגיאה בשמירה: ${res.status} ${await res.text()}`);
}

// קריאה-עדכון-כתיבה עם ניסיון חוזר למקרה של כתיבה בו-זמנית
async function updateIdeas(env, updateFn, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { ideas, sha } = await readIdeas(env);
    const { data, result } = updateFn(ideas);
    try {
      await writeIdeas(env, data, sha, message);
      return result;
    } catch (err) {
      if (attempt === 3) throw err;
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
// זהות - נשלחת מהדפדפן (uid אקראי + שם תצוגה). ללא סיסמה.
// ---------------------------------------------------------------------------
function identity(body) {
  const uid = (body.uid || "").trim();
  const name = (body.name || "").trim();
  if (!uid) throw new Error("חסר מזהה משתמש");
  if (!name) throw new Error("נא להזין שם תצוגה");
  return { uid, name: name.slice(0, 40) };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleGetIdeas(env) {
  const { ideas } = await readIdeas(env);
  return json({ ideas });
}

async function handleCreateIdea(request, env) {
  const body = await request.json();
  const { uid, name } = identity(body);
  const title = (body.title || "").trim();
  const desc = (body.desc || "").trim();
  const tag = (body.tag || "כללי").trim();
  if (!title || !desc) return json({ error: "נא למלא כותרת ותיאור" }, 400);

  const idea = await updateIdeas(env, (ideas) => {
    const newIdea = {
      id: crypto.randomUUID(),
      title, desc, tag,
      authorUid: uid,
      authorName: name,
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
  const body = await request.json();
  const { uid } = identity(body);
  const { ideaId, direction } = body;
  if (!["up", "down"].includes(direction)) return json({ error: "כיוון הצבעה לא תקין" }, 400);

  const idea = await updateIdeas(env, (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    const upSet = new Set(target.upvotes);
    const downSet = new Set(target.downvotes);
    if (direction === "up") {
      upSet.has(uid) ? upSet.delete(uid) : upSet.add(uid);
      downSet.delete(uid);
    } else {
      downSet.has(uid) ? downSet.delete(uid) : downSet.add(uid);
      upSet.delete(uid);
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
  const body = await request.json();
  const { uid, name } = identity(body);
  const { ideaId } = body;

  const idea = await updateIdeas(env, (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    if (target.authorUid === uid) throw new Error("אתה לא יכול לאמץ את הרעיון של עצמך");
    if (target.status !== "open") throw new Error("הרעיון כבר נלקח");
    target.status = "taken";
    target.takenByUid = uid;
    target.takenByName = name;
    const updated = [...ideas];
    updated[idx] = target;
    return { data: updated, result: target };
  }, `Claim idea ${ideaId}`);

  return json({ idea });
}

async function handleFinish(request, env) {
  const body = await request.json();
  const { uid } = identity(body);
  const { ideaId } = body;

  const idea = await updateIdeas(env, (ideas) => {
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error("רעיון לא נמצא");
    const target = { ...ideas[idx] };
    if (target.takenByUid !== uid) throw new Error("רק מי שאימץ את הרעיון יכול לסמן אותו כבוצע");
    target.status = "done";
    const updated = [...ideas];
    updated[idx] = target;
    return { data: updated, result: target };
  }, `Finish idea ${ideaId}`);

  return json({ idea });
}
