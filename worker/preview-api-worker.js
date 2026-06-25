const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8"
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "https://zhukinak.github.io,http://127.0.0.1:4173,http://localhost:4173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...corsHeaders(request, env)
    }
  });
}

function errorResponse(request, env, message, status = 400) {
  return jsonResponse(request, env, { error: message }, status);
}

function assertEnv(env) {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET", "ACCESS_HASH"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Worker is missing: ${missing.join(", ")}`);
  }
}

function base64url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(payload, env) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64url(new Uint8Array(signature));
}

async function createToken(roomId, env) {
  const payload = base64url(JSON.stringify({
    roomId,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  }));
  return `${payload}.${await sign(payload, env)}`;
}

async function verifyToken(request, env) {
  const url = new URL(request.url);
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
  if (!token) throw new Error("Нет входа.");

  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await sign(payload, env)) {
    throw new Error("Вход устарел.");
  }

  const data = JSON.parse(fromBase64url(payload));
  if (!data.roomId || !data.exp || data.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Вход устарел.");
  }

  return data;
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function supabaseFetch(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Supabase ${response.status}`);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("Content-Type") || "";
  return contentType.includes("application/json") ? response.json() : response;
}

async function getRoom(roomSlug, env) {
  const rows = await supabaseFetch(
    env,
    `/rest/v1/rooms?select=id,slug&slug=eq.${encodeURIComponent(roomSlug)}&limit=1`
  );
  return rows[0] || null;
}

async function handleJoin(request, env) {
  const body = await request.json().catch(() => ({}));
  const passphrase = String(body.passphrase || "").trim();
  const roomSlug = String(body.roomSlug || env.ROOM_SLUG || "preview").trim();
  const hash = await sha256(passphrase);

  if (hash !== env.ACCESS_HASH) {
    return errorResponse(request, env, "Не та фраза.", 403);
  }

  const room = await getRoom(roomSlug, env);
  if (!room) {
    return errorResponse(request, env, "Комната не найдена.", 404);
  }

  return jsonResponse(request, env, {
    roomId: room.id,
    token: await createToken(room.id, env)
  });
}

async function listMemories(request, env, session) {
  const items = await supabaseFetch(
    env,
    `/rest/v1/memories?select=id,text,created_at&room_id=eq.${session.roomId}&deleted_at=is.null&order=created_at.desc`
  );
  return jsonResponse(request, env, { items });
}

async function createMemory(request, env, session) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 600);
  if (!text) return errorResponse(request, env, "Пустая запись.");

  const rows = await supabaseFetch(env, "/rest/v1/memories", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ room_id: session.roomId, text })
  });
  return jsonResponse(request, env, { item: rows[0] });
}

async function deleteMemory(request, env, session, id) {
  await supabaseFetch(env, `/rest/v1/memories?id=eq.${encodeURIComponent(id)}&room_id=eq.${session.roomId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ deleted_at: new Date().toISOString() })
  });
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function listGallery(request, env, session) {
  const items = await supabaseFetch(
    env,
    `/rest/v1/gallery_items?select=id,caption,created_at&room_id=eq.${session.roomId}&deleted_at=is.null&order=created_at.desc`
  );
  return jsonResponse(request, env, { items });
}

async function createGalleryItem(request, env, session) {
  const formData = await request.formData();
  const file = formData.get("file");
  const caption = String(formData.get("caption") || "").trim().slice(0, 80);
  if (!(file instanceof File)) {
    return errorResponse(request, env, "Нет картинки.");
  }
  if (!file.type.startsWith("image/")) {
    return errorResponse(request, env, "Можно загрузить только картинку.");
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/gif" ? "gif" : "jpg";
  const storagePath = `${session.roomId}/${crypto.randomUUID()}.${extension}`;
  await supabaseFetch(env, `/storage/v1/object/gallery/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false"
    },
    body: file
  });

  const rows = await supabaseFetch(env, "/rest/v1/gallery_items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      room_id: session.roomId,
      caption,
      storage_path: storagePath
    })
  });

  return jsonResponse(request, env, { item: rows[0] });
}

async function deleteGalleryItem(request, env, session, id) {
  await supabaseFetch(env, `/rest/v1/gallery_items?id=eq.${encodeURIComponent(id)}&room_id=eq.${session.roomId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ deleted_at: new Date().toISOString() })
  });
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

async function serveGalleryFile(request, env, session, id) {
  const rows = await supabaseFetch(
    env,
    `/rest/v1/gallery_items?select=storage_path&room_id=eq.${session.roomId}&id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1`
  );
  const item = rows[0];
  if (!item) return errorResponse(request, env, "Картинка не найдена.", 404);

  let response;
  try {
    response = await supabaseFetch(
      env,
      `/storage/v1/object/authenticated/gallery/${encodeStoragePath(item.storage_path)}`
    );
  } catch {
    response = await supabaseFetch(
      env,
      `/storage/v1/object/gallery/${encodeStoragePath(item.storage_path)}`
    );
  }
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Access-Control-Allow-Origin", corsHeaders(request, env)["Access-Control-Allow-Origin"]);
  return new Response(response.body, { status: 200, headers });
}

async function handleRequest(request, env) {
  assertEnv(env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/auth/join" && request.method === "POST") {
    return handleJoin(request, env);
  }

  let session;
  try {
    session = await verifyToken(request, env);
  } catch (error) {
    return errorResponse(request, env, error.message, 401);
  }

  if (path === "/memories" && request.method === "GET") return listMemories(request, env, session);
  if (path === "/memories" && request.method === "POST") return createMemory(request, env, session);
  if (path.startsWith("/memories/") && request.method === "DELETE") {
    return deleteMemory(request, env, session, path.split("/")[2]);
  }

  if (path === "/gallery" && request.method === "GET") return listGallery(request, env, session);
  if (path === "/gallery" && request.method === "POST") return createGalleryItem(request, env, session);
  if (path.startsWith("/gallery/file/") && request.method === "GET") {
    return serveGalleryFile(request, env, session, path.split("/")[3]);
  }
  if (path.startsWith("/gallery/") && request.method === "DELETE") {
    return deleteGalleryItem(request, env, session, path.split("/")[2]);
  }

  return errorResponse(request, env, "Не найдено.", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return errorResponse(request, env, error.message || "Ошибка API.", 500);
    }
  }
};
