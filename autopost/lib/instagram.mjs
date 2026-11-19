// Instagram Reels through the Instagram Graph API (Facebook Login for Business: an Instagram professional
// account linked to a Facebook Page). The video is sent from the runner with a resumable upload, so it
// never needs a public web address.
// Secrets: INSTAGRAM_USER_ID (the Instagram account's id, not the username) and INSTAGRAM_ACCESS_TOKEN
// (a Page access token with instagram_basic and instagram_content_publish).
import { readFileSync, statSync } from "node:fs";
import { request, form, poll } from "./http.mjs";

export const SECRETS = ["INSTAGRAM_USER_ID", "INSTAGRAM_ACCESS_TOKEN"];
const graph = (opts) => `https://graph.facebook.com/${opts.apiVersion ?? "v23.0"}`;

export async function check(env, opts = {}) {
  const { body } = await request(`${graph(opts)}/${env.INSTAGRAM_USER_ID}?fields=username`, {
    headers: { Authorization: `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}` },
  }, "Instagram account lookup");
  return `account @${body.username}`;
}

// item.instagram = { caption }, opts = config.platforms.instagram
export async function post(item, files, opts, env) {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  const auth = { Authorization: `Bearer ${token}` };
  const params = {
    media_type: "REELS",
    upload_type: "resumable",
    caption: item.instagram.caption ?? "",
    share_to_feed: opts.shareToFeed ?? true,
  };
  // Instagram needs a public address for a cover image, so the cover is picked as a frame of the video.
  if (item.coverAtSeconds != null) params.thumb_offset = Math.round(item.coverAtSeconds * 1000);
  if (opts.isAiGenerated) params.is_ai_generated = true;

  const { body: container } = await request(`${graph(opts)}/${env.INSTAGRAM_USER_ID}/media`, {
    method: "POST", headers: auth, body: form(params),
  }, "Instagram reel start");

  const size = statSync(files.video).size;
  await request(`https://rupload.facebook.com/ig-api-upload/${opts.apiVersion ?? "v23.0"}/${container.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(size) },
    body: readFileSync(files.video),
  }, "Instagram video upload");

  await poll(async () => {
    const { body } = await request(`${graph(opts)}/${container.id}?fields=status_code,status`, { headers: auth }, "Instagram status");
    if (body.status_code === "FINISHED") return true;
    if (body.status_code === "ERROR" || body.status_code === "EXPIRED") throw new Error(`Instagram could not process the video: ${body.status ?? body.status_code}`);
    return undefined;
  }, { everyMs: 10000, timeoutMs: 15 * 60000, what: "Instagram processing" });

  const { body: published } = await request(`${graph(opts)}/${env.INSTAGRAM_USER_ID}/media_publish`, {
    method: "POST", headers: auth, body: form({ creation_id: container.id }),
  }, "Instagram publish");

  let url;
  try {
    const { body } = await request(`${graph(opts)}/${published.id}?fields=permalink`, { headers: auth }, "Instagram link");
    url = body.permalink;
  } catch { /* the post is up even if the link lookup fails */ }
  return { id: published.id, url };
}
