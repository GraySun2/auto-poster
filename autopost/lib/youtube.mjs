// YouTube Shorts through the YouTube Data API v3. A Short is an ordinary upload that is vertical and
// at most 3 minutes long; "#Shorts" in the title or description helps YouTube file it.
// Secrets: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (scope youtube.upload).
import { readFileSync, statSync } from "node:fs";
import { request, form } from "./http.mjs";

export const SECRETS = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"];

async function accessToken(env) {
  const { body } = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: form({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  }, "YouTube sign-in (refresh token)");
  return body.access_token;
}

// Checks the sign-in works and names the channel it posts to. Costs 1 quota unit.
export async function check(env) {
  const token = await accessToken(env);
  const { body } = await request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
  }, "YouTube channel lookup");
  const ch = body.items?.[0];
  return ch ? `channel "${ch.snippet.title}"` : "signed in, but this Google account has no YouTube channel";
}

// item.youtube = { title, description, tags? }, opts = config.platforms.youtube, privacy = "public" | "private" | "unlisted"
export async function post(item, files, opts, env, privacy) {
  const token = await accessToken(env);
  const size = statSync(files.video).size;
  const meta = {
    snippet: {
      title: item.youtube.title,
      description: item.youtube.description ?? "",
      tags: item.youtube.tags ?? [],
      categoryId: String(opts.categoryId ?? "20"),
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: Boolean(opts.madeForKids),
      containsSyntheticMedia: Boolean(opts.containsSyntheticMedia),
    },
  };
  // Resumable upload: one call to open the session, one PUT with the whole file.
  const { res } = await request(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(meta),
    }, "YouTube upload start");
  const session = res.headers.get("location");
  if (!session) throw new Error("YouTube upload start gave no upload address");
  const { body: video } = await request(session, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: readFileSync(files.video),
  }, "YouTube upload");

  const result = { id: video.id, url: `https://youtube.com/shorts/${video.id}`, privacy: video.status?.privacyStatus };
  if (privacy !== video.status?.privacyStatus) {
    result.note = `asked for ${privacy}, YouTube set ${video.status?.privacyStatus}`;
  }
  // Custom thumbnails need a phone-verified channel and are not shown in the Shorts feed, so a failure here
  // is a note, not a failed post.
  if (opts.setThumbnail && files.cover) {
    try {
      await request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}&uploadType=media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
        body: readFileSync(files.cover),
      }, "YouTube thumbnail");
    } catch (e) {
      result.note = [result.note, `thumbnail not set: ${e.message.slice(0, 200)}`].filter(Boolean).join("; ");
    }
  }
  return result;
}
