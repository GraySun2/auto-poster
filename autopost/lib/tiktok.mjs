// TikTok through the Content Posting API. Two ways in, set by config.platforms.tiktok.method:
//   "inbox"  (scope video.upload): the video lands in the creator's TikTok inbox as a draft, and they
//            finish the post in the app (caption, sound, Post). Works before TikTok audits the app.
//   "direct" (scope video.publish): posts straight to the profile. Until TikTok audits the app, direct
//            posts are private-only and only allowed on a private account.
// Secrets: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN. TikTok may hand back a new
// refresh token when it is used; it is saved back to the repository if AUTOPOST_ADMIN_TOKEN is set.
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { request, form, poll } from "./http.mjs";
import { canSaveSecrets, saveSecret } from "./secrets.mjs";

export const SECRETS = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"];
const API = "https://open.tiktokapis.com/v2";

export async function exchangeCode(env, code, redirectUri) {
  const { body } = await request(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: env.TIKTOK_CLIENT_KEY.trim(), client_secret: env.TIKTOK_CLIENT_SECRET.trim(),
      code, grant_type: "authorization_code", redirect_uri: redirectUri,
    }),
  }, "TikTok sign-in (code)");
  if (!body.refresh_token) throw new Error(`TikTok sign-in gave no refresh token: ${body.error_description ?? body.error ?? "no detail"}`);
  return body;
}

async function accessToken(env) {
  const { body } = await request(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: env.TIKTOK_CLIENT_KEY.trim(), client_secret: env.TIKTOK_CLIENT_SECRET.trim(),
      refresh_token: env.TIKTOK_REFRESH_TOKEN.trim(), grant_type: "refresh_token",
    }),
  }, "TikTok sign-in (refresh token)");
  if (!body.access_token) throw new Error(`TikTok sign-in failed: ${body.error_description ?? body.error ?? "no access token"}`);
  if (body.refresh_token && body.refresh_token !== env.TIKTOK_REFRESH_TOKEN) {
    if (canSaveSecrets(env)) {
      saveSecret(env, "TIKTOK_REFRESH_TOKEN", body.refresh_token);
      env.TIKTOK_REFRESH_TOKEN = body.refresh_token;
    } else {
      console.log("Note: TikTok issued a new refresh token and AUTOPOST_ADMIN_TOKEN is not set, so it was not saved. The old one keeps working until it expires (about a year after the connect step).");
    }
  }
  return body.access_token;
}

async function api(path, token, payload, what) {
  const { body } = await request(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload ?? {}),
  }, what);
  if (body.error && body.error.code && body.error.code !== "ok") throw new Error(`${what} failed: ${body.error.code}: ${body.error.message}`);
  return body.data;
}

export async function check(env, opts = {}) {
  const token = await accessToken(env);
  if ((opts.method ?? "inbox") === "direct") {
    const info = await api("/post/publish/creator_info/query/", token, {}, "TikTok creator info");
    return `account @${info.creator_username}, may post as: ${info.privacy_level_options.join(", ")}`;
  }
  return "signed in (inbox mode: videos go to your TikTok inbox as drafts)";
}

// TikTok's chunk rules: one chunk up to 64 MB; above that, chunks of 5 to 64 MB, the last one taking the rest.
function chunkPlan(size) {
  if (size <= 64 * 1024 * 1024) return { chunkSize: size, count: 1 };
  const chunkSize = 32 * 1024 * 1024;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

async function uploadChunks(uploadUrl, path, size, plan) {
  const fd = openSync(path, "r");
  try {
    for (let i = 0; i < plan.count; i++) {
      const start = i * plan.chunkSize;
      const end = i === plan.count - 1 ? size - 1 : start + plan.chunkSize - 1;
      const buf = Buffer.alloc(end - start + 1);
      readSync(fd, buf, 0, buf.length, start);
      await request(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${size}` },
        body: buf,
      }, `TikTok upload (part ${i + 1} of ${plan.count})`);
    }
  } finally { closeSync(fd); }
}

// item.tiktok = { caption }, opts = config.platforms.tiktok, privacy = the TikTok privacy level to ask for
export async function post(item, files, opts, env, privacy) {
  const token = await accessToken(env);
  const method = opts.method ?? "inbox";
  const size = statSync(files.video).size;
  const plan = chunkPlan(size);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count };

  let init;
  if (method === "direct") {
    const info = await api("/post/publish/creator_info/query/", token, {}, "TikTok creator info");
    if (!info.privacy_level_options.includes(privacy)) {
      throw new Error(`TikTok won't let this account post as ${privacy} right now (it allows ${info.privacy_level_options.join(", ")}). Unaudited apps can only post privately.`);
    }
    const post_info = {
      title: item.tiktok.caption ?? "",
      privacy_level: privacy,
      disable_comment: Boolean(opts.disableComment),
      disable_duet: Boolean(opts.disableDuet),
      disable_stitch: Boolean(opts.disableStitch),
      is_aigc: Boolean(opts.isAigc),
    };
    if (item.coverAtSeconds != null) post_info.video_cover_timestamp_ms = Math.round(item.coverAtSeconds * 1000);
    init = await api("/post/publish/video/init/", token, { post_info, source_info }, "TikTok post start");
  } else {
    init = await api("/post/publish/inbox/video/init/", token, { source_info }, "TikTok inbox start");
  }

  await uploadChunks(init.upload_url, files.video, size, plan);

  const done = method === "direct" ? "PUBLISH_COMPLETE" : "SEND_TO_USER_INBOX";
  const status = await poll(async () => {
    const d = await api("/post/publish/status/fetch/", token, { publish_id: init.publish_id }, "TikTok status");
    if (d.status === done || d.status === "PUBLISH_COMPLETE") return d;
    if (d.status === "FAILED") throw new Error(`TikTok could not take the video: ${d.fail_reason ?? "no reason given"}`);
    return undefined;
  }, { everyMs: 5000, timeoutMs: 10 * 60000, what: "TikTok processing" });

  const result = { id: init.publish_id, status: status.status };
  if (method === "inbox") result.note = "in your TikTok inbox: open TikTok, tap the notification, paste the caption, Post";
  return result;
}
