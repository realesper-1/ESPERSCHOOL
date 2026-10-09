// Cloudflare Pages Function: accounts, sessions, saves, global Tour de France leaderboard (D1).
const E = new TextEncoder();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hx = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const ux = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const rnd = (n) => hx(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (t) => hx(await crypto.subtle.digest("SHA-256", E.encode(t)));
async function pbk(p, salt) {
  const k = await crypto.subtle.importKey("raw", E.encode(p), "PBKDF2", false, ["deriveBits"]);
  return hx(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: ux(salt), iterations: 100000 }, k, 256));
}
// ---- name filter (edit this list freely). Matches after removing look-alike characters and repeated letters.
const BAD = ["fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "whore", "slut", "bastard", "asshole", "nigg", "fagg", "retard", "rape", "nazi", "hitler", "porn", "penis", "vagina", "kkk", "jihad", "admin", "moderator", "staff", "system", "anonymous", "roadracer"];
const norm = (t) => t.toLowerCase().replace(/[@4]/g, "a").replace(/3/g, "e").replace(/[1!|]/g, "i").replace(/0/g, "o").replace(/[$5]/g, "s").replace(/7/g, "t").replace(/[^a-z]/g, "");
const sq = (t) => t.replace(/(.)\1+/g, "$1");
const bad = (n) => { const x = norm(n), y = sq(x); return BAD.some((w) => x.includes(w) || y.includes(sq(w))); };
const okName = (n) => /^[A-Za-z0-9_]{3,16}$/.test(n);
async function session(env, uid) {
  const tok = rnd(32);
  await env.DB.prepare("INSERT INTO sessions(tok,uid,exp) VALUES(?,?,?)").bind(await sha(tok), uid, Date.now() + 30 * 864e5).run();
  return tok;
}
async function who(env, request) {
  const tok = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!tok) return null;
  return env.DB.prepare("SELECT u.id,u.name,u.profile FROM sessions s JOIN users u ON u.id=s.uid WHERE s.tok=? AND s.exp>?").bind(await sha(tok), Date.now()).first();
}
const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
export async function onRequest({ request, env }) {
  if (!env.DB) return J({ error: "Database is not bound (see README)." }, 500);
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, ""), m = request.method;
  try {
    if (m === "GET" && path === "check") {
      const u = (url.searchParams.get("u") || "").trim();
      if (!okName(u)) return J({ ok: false, why: "3–16 letters, numbers or _" });
      if (bad(u)) return J({ ok: false, why: "Name not allowed" });
      const r = await env.DB.prepare("SELECT 1 x FROM users WHERE lower=?").bind(u.toLowerCase()).first();
      return J({ ok: !r, why: r ? "Already taken" : "Available" });
    }
    if (m === "POST" && path === "register") {
      const b = await request.json(), u = String(b.u || "").trim(), p = String(b.p || "");
      if (!okName(u)) return J({ error: "Username must be 3–16 letters, numbers or _." }, 400);
      if (bad(u)) return J({ error: "That username isn't allowed." }, 400);
      if (p.length < 6 || p.length > 64) return J({ error: "Password must be 6–64 characters." }, 400);
      let prof = "{}";
      if (b.profile && typeof b.profile === "object") { const t = JSON.stringify(b.profile); if (t.length < 30000) prof = t; }
      const salt = rnd(16), hash = await pbk(p, salt);
      let uid;
      try { uid = (await env.DB.prepare("INSERT INTO users(name,lower,salt,hash,profile,created) VALUES(?,?,?,?,?,?)").bind(u, u.toLowerCase(), salt, hash, prof, Date.now()).run()).meta.last_row_id; }
      catch (e) { return J({ error: "That username is already taken." }, 409); }
      return J({ token: await session(env, uid), user: u, profile: parse(prof) });
    }
    if (m === "POST" && path === "login") {
      const b = await request.json(), u = String(b.u || "").trim(), p = String(b.p || "");
      const row = await env.DB.prepare("SELECT * FROM users WHERE lower=?").bind(u.toLowerCase()).first();
      if (!row) { await pbk(p, "00".repeat(16)); return J({ error: "Wrong username or password." }, 401); }
      if (row.lock > Date.now()) return J({ error: "Too many attempts. Try again in a minute." }, 429);
      if ((await pbk(p, row.salt)) !== row.hash) {
        const f = row.fails + 1;
        await env.DB.prepare("UPDATE users SET fails=?,lock=? WHERE id=?").bind(f >= 5 ? 0 : f, f >= 5 ? Date.now() + 60000 : 0, row.id).run();
        return J({ error: "Wrong username or password." }, 401);
      }
      await env.DB.prepare("UPDATE users SET fails=0,lock=0 WHERE id=?").bind(row.id).run();
      return J({ token: await session(env, row.id), user: row.name, profile: parse(row.profile) });
    }
    if (path === "logout" && m === "POST") {
      const tok = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
      if (tok) await env.DB.prepare("DELETE FROM sessions WHERE tok=?").bind(await sha(tok)).run();
      return J({ ok: true });
    }
    if (m === "GET" && path === "leaderboard") {
      const rows = (await env.DB.prepare("SELECT u.name,t.ms FROM tour_times t JOIN users u ON u.id=t.uid ORDER BY t.ms ASC LIMIT 25").all()).results;
      return J({ rows });
    }
    const me = await who(env, request);
    if (!me) return J({ error: "Not signed in." }, 401);
    if (m === "GET" && path === "me") return J({ user: me.name, profile: parse(me.profile) });
    if (m === "PUT" && path === "save") {
      const b = await request.json(), t = JSON.stringify(b.profile || {});
      if (t.length > 30000) return J({ error: "Profile too large." }, 413);
      await env.DB.prepare("UPDATE users SET profile=? WHERE id=?").bind(t, me.id).run();
      return J({ ok: true });
    }
    if (m === "POST" && path === "tour") {
      const b = await request.json(), ms = Math.round(Number(b.ms));
      if (!(ms >= 200000 && ms <= 7200000)) return J({ error: "Invalid time." }, 400);
      await env.DB.prepare("INSERT INTO tour_times(uid,ms,at) VALUES(?,?,?) ON CONFLICT(uid) DO UPDATE SET ms=CASE WHEN excluded.ms<ms THEN excluded.ms ELSE ms END, at=CASE WHEN excluded.ms<ms THEN excluded.at ELSE at END").bind(me.id, ms, Date.now()).run();
      const rank = (await env.DB.prepare("SELECT COUNT(*)+1 r FROM tour_times WHERE ms<(SELECT ms FROM tour_times WHERE uid=?)").bind(me.id).first()).r;
      return J({ ok: true, rank });
    }
    return J({ error: "Not found" }, 404);
  } catch (e) {
    return J({ error: "Server error" }, 500);
  }
}
