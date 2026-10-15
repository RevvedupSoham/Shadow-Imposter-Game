import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const actions = new Set([
  "create_room", "join_room", "start_game", "submit_clue", "send_chat",
  "begin_voting", "vote", "guess_secret", "get_state", "leave_room",
]);
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Use POST." }, 405);
  const maxBytes = 8_192;
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) return respond({ error: "Request too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > maxBytes) return respond({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
    if (body === null || typeof body !== "object" || Array.isArray(body)) return respond({ error: "Invalid request." }, 400);
  } catch { return respond({ error: "Invalid JSON." }, 400); }

  const action = typeof body.action === "string" ? body.action : "";
  if (!actions.has(action)) return respond({ error: "Unknown game action." }, 400);
  const payload: Record<string, unknown> = {};
  for (const key of ["code", "name", "message", "clue", "guess", "target_player_id", "token"]) {
    if (typeof body[key] === "string") payload[key] = body[key];
  }
  const token = typeof payload.token === "string" ? payload.token : "";
  if (token.length < 32 || token.length > 200) return respond({ error: "Missing or invalid player token." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !key) return respond({ error: "Game backend is not configured." }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const rawIp = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = action === "create_room" || action === "join_room" ? "room_entry" : "game_action";
  const { data: allowed, error: rateError } = await admin.rpc("check_game_rate_limit", {
    p_ip_hash: await sha256(rawIp), p_action_key: rateKey, p_limit: rateKey === "room_entry" ? 8 : 120,
  });
  if (rateError) return respond({ error: "Rate limiter unavailable. Try again shortly." }, 503);
  if (!allowed) return respond({ error: "Too many requests. Wait a minute and try again." }, 429);

  const { data: result, error } = await admin.rpc("game_action", { p_action: action, p_payload: payload });
  if (error) {
    const msg = error.message ?? "";
    const known = ["Unknown action", "Invalid player token", "Name must", "Name contains", "Room not found", "Game already started", "Room is full", "At least 4", "Only the host", "Not in discussion", "Not in voting", "Voting is closed", "Clue phase is closed", "Eliminated players", "Clue must", "Message must", "Chat is closed", "Invalid room token", "Invalid vote target", "You cannot", "Could not allocate", "Invalid room code", "You cannot make this guess"];
    return respond({ error: known.some((prefix) => msg.includes(prefix)) ? msg : "Game action could not be completed." }, 400);
  }
  const code = typeof payload.code === "string" ? payload.code.toUpperCase() : (result?.code ?? "");
  if (action === "leave_room") return respond({ ok: true });
  if (!code) return respond({ error: "Room code was not returned." }, 500);
  const { data: state, error: stateError } = await admin.rpc("game_action", { p_action: "get_state", p_payload: { code, token } });
  if (stateError) return respond({ error: "Could not load game state." }, 500);
  const { data: stats, error: statsError } = await admin.rpc("get_player_stats", { p_token: token });
  if (statsError) return respond({ error: "Could not load player stats." }, 500);
  if (action !== "get_state") {
    try {
      const channel = admin.channel("room:" + code);
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(finish, 900);
        channel.subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            try { await channel.send({ type: "broadcast", event: "changed", payload: { code } }); } catch { /* optional invalidation */ }
            finish();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") finish();
        });
      });
      await admin.removeChannel(channel);
    } catch { /* polling remains available */ }
  }
  return respond({ ...state, stats, player_token: token });
});
