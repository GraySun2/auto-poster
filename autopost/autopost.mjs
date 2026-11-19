#!/usr/bin/env node
// Autopost: posts the next video in queue.json to YouTube Shorts, Instagram Reels and TikTok at the
// times in config.json. Run by .github/workflows/autopost.yml every hour; see README.md.
//
//   node autopost/autopost.mjs plan      decide what this run does; writes .autopost-plan.json
//   node autopost/autopost.mjs run       do it (after the workflow has checked out the video files)
//   node autopost/autopost.mjs check     sign in to each app and say which account it would post to
//   node autopost/autopost.mjs validate  check config.json and queue.json (and the files, if present)
//   node autopost/autopost.mjs status    what has posted, what is next, and the next posting times
//   node autopost/autopost.mjs connect-tiktok-link  print the TikTok sign-in link
//   node autopost/autopost.mjs connect-tiktok     one-time sign-in (needs TIKTOK_CODE and TIKTOK_REDIRECT_URI)
//   node autopost/autopost.mjs connect-instagram  one-time sign-in (needs META_USER_TOKEN)
//
// Mode (repository variable AUTOPOST_MODE, or the "mode" box when run by hand):
//   off      do nothing (the pause switch)
//   dry-run  say what would post, post nothing (the default when the variable is not set)
//   test     post privately: YouTube as private, TikTok to your inbox as a draft, Instagram skipped
//            (Instagram has no private posts). Keeps its own place in the queue.
//   live     post for real, as config.json says

import { readFileSync, writeFileSync, existsSync, statSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dueSlot, upcomingSlots, validateSlots, localParts } from "./lib/schedule.mjs";
import * as youtube from "./lib/youtube.mjs";
import * as instagram from "./lib/instagram.mjs";
import * as tiktok from "./lib/tiktok.mjs";
import { saveSecret } from "./lib/secrets.mjs";
import { request, form } from "./lib/http.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PLATFORMS = { youtube, instagram, tiktok };
const MODES = ["off", "dry-run", "test", "live"];
const env = { ...process.env };

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const config = readJson(join(HERE, "config.json"));
const queue = readJson(join(HERE, "queue.json"));
const STATE_DIR = resolve(ROOT, env.AUTOPOST_STATE_DIR || ".autopost-state");
const LOG_PATH = join(STATE_DIR, "log.json");
const PLAN_PATH = join(ROOT, ".autopost-plan.json");
const MAX_ATTEMPTS = config.maxAttempts ?? 3;

function mode() {
  const m = (env.AUTOPOST_MODE_OVERRIDE || env.AUTOPOST_MODE || "dry-run").trim().toLowerCase();
  if (!MODES.includes(m)) throw new Error(`AUTOPOST_MODE is "${m}"; use one of ${MODES.join(", ")}`);
  return m;
}
const logMode = (m) => (m === "dry-run" ? "live" : m); // a dry run previews the live queue

function readLog() {
  return existsSync(LOG_PATH) ? readJson(LOG_PATH) : { posts: [] };
}
function writeLog(log) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + "\n");
}

function summary(md) {
  console.log(md);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n");
}
function output(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}<<__EOF__\n${value}\n__EOF__\n`);
}

const mediaPath = (rel) => (rel ? resolve(ROOT, config.mediaRoot ?? "media", rel) : null);

// `posted` marks what was posted by hand before autopost: true or any text = every app, a list = those apps.
const postedBy = (item, name) => Array.isArray(item.posted) ? item.posted.includes(name) : Boolean(item.posted);
const allPosted = (item) => Object.keys(PLATFORMS).filter((n) => config.platforms?.[n]?.enabled).every((n) => postedBy(item, n));

// Which platforms an item goes to, and why any are left out.
function platformsFor(item, m) {
  const on = [], off = [];
  for (const [name, mod] of Object.entries(PLATFORMS)) {
    const opts = config.platforms?.[name] ?? {};
    if (!opts.enabled) { off.push(`${name}: turned off in config.json`); continue; }
    if (item.platforms && !item.platforms.includes(name)) { off.push(`${name}: not in this item's platforms`); continue; }
    if (postedBy(item, name)) { off.push(`${name}: already posted by hand`); continue; }
    if (!item[name]) { off.push(`${name}: no ${name} words in queue.json`); continue; }
    const missing = mod.SECRETS.filter((s) => !env[s]);
    if (missing.length) {
      if (m !== "dry-run") { off.push(`${name}: secrets not set (${missing.join(", ")})`); continue; }
      off.push(`${name}: listed above as a preview, but its secrets are not set yet (${missing.join(", ")})`);
    }
    if (m === "test" && name === "instagram") { off.push("instagram: skipped in test mode (Instagram has no private posts)"); continue; }
    on.push(name);
  }
  return { on, off };
}

// ---- validate ------------------------------------------------------------------------------------

function validate({ files = true } = {}) {
  const problems = [];
  try { validateSlots(config.slots ?? {}); } catch (e) { problems.push(e.message); }
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }); } catch { problems.push(`config.timezone "${config.timezone}" is not a time zone name (example: America/Chicago)`); }
  const seen = new Set();
  for (const [i, it] of (queue.items ?? []).entries()) {
    const at = `queue item ${i + 1} (${it.id ?? "no id"})`;
    if (!it.id) problems.push(`${at}: needs an id`);
    if (seen.has(it.id)) problems.push(`${at}: the id is used twice`);
    seen.add(it.id);
    if (!it.video) problems.push(`${at}: needs a video`);
    if (it.youtube) {
      if (!it.youtube.title) problems.push(`${at}: youtube.title is empty`);
      else if (it.youtube.title.length > 100) problems.push(`${at}: youtube.title is over 100 characters`);
      if (/[<>]/.test(it.youtube.title ?? "")) problems.push(`${at}: youtube.title can't contain < or >`);
      if ((it.youtube.description ?? "").length > 5000) problems.push(`${at}: youtube.description is over 5000 characters`);
    }
    if (it.instagram) {
      const c = it.instagram.caption ?? "";
      if (c.length > 2200) problems.push(`${at}: instagram.caption is over 2200 characters`);
      if ((c.match(/#\w/g) ?? []).length > 30) problems.push(`${at}: instagram.caption has over 30 hashtags`);
    }
    if (it.tiktok && (it.tiktok.caption ?? "").length > 2200) problems.push(`${at}: tiktok.caption is over 2200 characters`);
    if (files) {
      for (const k of ["video", "cover"]) {
        const p = mediaPath(it[k]);
        if (p && !existsSync(p)) problems.push(`${at}: ${k} file not found: ${config.mediaRoot ?? "media"}/${it[k]}`);
      }
      const v = mediaPath(it.video);
      if (v && existsSync(v) && statSync(v).size > 1024 ** 3) problems.push(`${at}: video is over 1 GB`);
    }
  }
  return problems;
}

// ---- plan ----------------------------------------------------------------------------------------

function nextItem(log, m) {
  const done = new Set(log.posts.filter((p) => p.mode === logMode(m)).map((p) => p.id));
  return (queue.items ?? []).find((it) => !it.hold && !allPosted(it) && !done.has(it.id)) ?? null;
}

function makePlan() {
  const m = mode();
  const log = readLog();
  const now = new Date();
  const postNow = /^(1|true|yes)$/i.test(env.AUTOPOST_POST_NOW ?? "");
  let plan = { mode: m, job: "none", why: "" };

  if (m === "off") {
    plan.why = "AUTOPOST_MODE is off (paused)";
  } else {
    // 1. A platform that failed on an earlier post gets another try first, without using up a slot.
    const retry = log.posts.find((p) => p.mode === logMode(m) && Object.values(p.results).some((r) => !r.ok && r.attempts < MAX_ATTEMPTS));
    const used = new Set(log.posts.filter((p) => p.mode === logMode(m)).map((p) => p.slot));
    const slot = postNow ? `manual ${now.toISOString()}` : dueSlot(now, config, used);
    if (retry && m !== "dry-run") {
      plan = { ...plan, job: "retry", id: retry.id, why: `retrying what failed on ${retry.id}` };
    } else if (slot) {
      const item = nextItem(log, m);
      if (!item) plan.why = `slot ${slot} is due but the queue is empty: add videos to queue.json`;
      else plan = { ...plan, job: "post", id: item.id, slot, why: postNow ? "posting now (run by hand)" : `slot ${slot} is due` };
    } else {
      const { ymd } = localParts(now, config.timezone);
      plan.why = `no slot due (${ymd}, ${config.timezone}); next: ${upcomingSlots(now, config, 1)[0] ?? "none set"}`;
    }
  }
  if (plan.id) {
    const item = queue.items.find((it) => it.id === plan.id);
    plan.dirs = [...new Set([item.video, item.cover].filter(Boolean).map((r) => dirname(join(config.mediaRoot ?? "media", r))))];
  }
  writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
  output("job", plan.job);
  output("dirs", (plan.dirs ?? []).join("\n"));
  console.log(`Mode ${m}: ${plan.job === "none" ? "nothing to do" : plan.job + " " + plan.id}. ${plan.why}`);
  return plan;
}

// ---- run -----------------------------------------------------------------------------------------

async function postTo(name, item, files, m) {
  const opts = config.platforms[name];
  if (name === "youtube") return youtube.post(item, files, opts, env, m === "test" ? "private" : (opts.privacy ?? "public"));
  if (name === "instagram") return instagram.post(item, files, opts, env);
  if (name === "tiktok") {
    const privacy = m === "test" ? "SELF_ONLY" : (opts.privacy ?? "PUBLIC_TO_EVERYONE");
    return tiktok.post(item, files, opts, env, privacy);
  }
}

async function run() {
  const plan = existsSync(PLAN_PATH) ? readJson(PLAN_PATH) : makePlan();
  rmSync(PLAN_PATH, { force: true }); // a plan is used once
  if (plan.job === "none") return 0;
  const m = plan.mode;
  const item = queue.items.find((it) => it.id === plan.id);
  const files = { video: mediaPath(item.video), cover: mediaPath(item.cover) };
  const problems = validate({ files: true }).filter((p) => p.includes(`(${item.id})`));
  if (problems.length) { summary(`### Autopost: can't post ${item.id}\n\n${problems.map((p) => `- ${p}`).join("\n")}`); return 1; }

  const log = readLog();
  let entry = log.posts.find((p) => p.id === item.id && p.mode === logMode(m));
  const { on, off } = platformsFor(item, m);
  const targets = plan.job === "retry"
    ? Object.entries(entry.results).filter(([, r]) => !r.ok && r.attempts < MAX_ATTEMPTS).map(([n]) => n)
    : on;

  if (m === "dry-run") {
    const size = (statSync(files.video).size / 1048576).toFixed(1);
    summary([
      `### Autopost dry run: would post \`${item.id}\` (${plan.why})`, "",
      `Video: ${config.mediaRoot ?? "media"}/${item.video} (${size} MB)`,
      ...on.map((n) => `- **${n}**: ${n === "youtube" ? `"${item.youtube.title}" as ${config.platforms.youtube.privacy ?? "public"}` : n === "tiktok" ? `via ${config.platforms.tiktok.method ?? "inbox"}` : "reel"}`),
      ...off.map((o) => `- left out: ${o}`),
      "", "Nothing was posted. Set the repository variable AUTOPOST_MODE to `test` or `live` to post.",
    ].join("\n"));
    return 0;
  }

  if (!targets.length) {
    // Nothing is ready, so the video keeps its place in the queue rather than being marked as posted.
    summary([`### Autopost (${m}): nothing posted, no app is ready`, "", ...off.map((o) => `- ${o}`), "", `${item.id} stays next in the queue.`].join("\n"));
    return 1;
  }
  if (!entry) {
    entry = { id: item.id, slot: plan.slot, mode: logMode(m), at: new Date().toISOString(), results: {}, skipped: off };
    log.posts.push(entry);
  }

  let failed = 0;
  const lines = [`### Autopost (${m}): ${item.id}`, ""];
  for (const name of targets) {
    const prev = entry.results[name] ?? { attempts: 0 };
    try {
      const r = await postTo(name, item, files, m);
      entry.results[name] = { ok: true, attempts: prev.attempts + 1, at: new Date().toISOString(), ...r };
      lines.push(`- **${name}**: posted${r.url ? ` ${r.url}` : ""}${r.note ? ` (${r.note})` : ""}`);
    } catch (e) {
      failed++;
      entry.results[name] = { ok: false, attempts: prev.attempts + 1, at: new Date().toISOString(), error: e.message.slice(0, 1000) };
      const more = prev.attempts + 1 < MAX_ATTEMPTS ? "will try again next hour" : "gave up after " + MAX_ATTEMPTS + " tries";
      lines.push(`- **${name}**: FAILED, ${more}: ${e.message.slice(0, 500)}`);
    }
    writeLog(log); // after each platform, so a crash never makes it post twice
  }
  for (const o of off) lines.push(`- left out: ${o}`);
  if (targets.includes("tiktok") && (config.platforms.tiktok.method ?? "inbox") === "inbox" && entry.results.tiktok?.ok) {
    lines.push("", "TikTok caption to paste:", "", "```text", item.tiktok.caption, "```");
  }
  writeLog(log);
  summary(lines.join("\n"));
  return failed ? 1 : 0;
}

// ---- check / status ------------------------------------------------------------------------------

async function check() {
  let bad = 0;
  for (const [name, mod] of Object.entries(PLATFORMS)) {
    const opts = config.platforms?.[name] ?? {};
    const missing = mod.SECRETS.filter((s) => !env[s]);
    if (!opts.enabled) { console.log(`${name}: turned off in config.json`); continue; }
    if (missing.length) { console.log(`${name}: not set up yet (missing secrets: ${missing.join(", ")})`); continue; }
    try { console.log(`${name}: OK, ${await mod.check(env, opts)}`); }
    catch (e) { bad++; console.log(`${name}: FAILED: ${e.message}`); }
  }
  return bad ? 1 : 0;
}

function status() {
  const m = mode();
  const log = readLog();
  const mine = log.posts.filter((p) => p.mode === logMode(m));
  const done = new Set(mine.map((p) => p.id));
  const left = (queue.items ?? []).filter((it) => !it.hold && !allPosted(it) && !done.has(it.id));
  summary([
    `### Autopost status (mode ${m})`, "",
    `Posted: ${mine.length} by autopost, ${(queue.items ?? []).filter(allPosted).length} marked as posted by hand on every app. Left in the queue: ${left.length}. On hold: ${(queue.items ?? []).filter((i) => i.hold).length}.`,
    `Next up: ${left.slice(0, 3).map((i) => i.id).join(", ") || "nothing"}`,
    `Next times (${config.timezone}): ${upcomingSlots(new Date(), config, 5).join("; ")}`,
    ...mine.slice(-5).map((p) => `- ${p.id} (${p.slot}): ${Object.entries(p.results).map(([n, r]) => `${n} ${r.ok ? "ok" : "failed"}`).join(", ") || "nothing posted"}`),
  ].join("\n"));
  return 0;
}

// ---- one-time connect steps ----------------------------------------------------------------------

function tiktokLink() {
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_REDIRECT_URI"]) if (!env[k]) throw new Error(`${k} is not set (README, "TikTok")`);
  const scope = (config.platforms?.tiktok?.method ?? "inbox") === "direct" ? "user.info.basic,video.publish" : "user.info.basic,video.upload";
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.search = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY.trim(), scope, response_type: "code", redirect_uri: env.TIKTOK_REDIRECT_URI.trim(), state: "autopost" }).toString();
  summary(`### TikTok sign-in link\n\nOpen this, sign in to the TikTok account to post to, and allow it:\n\n${u}\n\nYou land on ${env.TIKTOK_REDIRECT_URI.trim()} with \`?code=...\` in the address. Copy everything after \`code=\` up to the next \`&\`, then run "Autopost connect" again with app "tiktok" and paste it. The code works for a few minutes only.`);
  return 0;
}

async function connectTiktok() {
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_CODE", "TIKTOK_REDIRECT_URI"]) if (!env[k]) throw new Error(`${k} is not set`);
  const code = decodeURIComponent(env.TIKTOK_CODE.trim());
  const body = await tiktok.exchangeCode(env, code, env.TIKTOK_REDIRECT_URI.trim());
  saveSecret(env, "TIKTOK_REFRESH_TOKEN", body.refresh_token);
  console.log(`TikTok connected; TIKTOK_REFRESH_TOKEN saved (good for about ${Math.round((body.refresh_expires_in ?? 31536000) / 86400)} days, renewed as it is used).`);
  return 0;
}

async function connectInstagram() {
  for (const k of ["META_APP_ID", "META_APP_SECRET", "META_USER_TOKEN"]) if (!env[k]) throw new Error(`${k} is not set`);
  const v = config.platforms?.instagram?.apiVersion ?? "v23.0";
  const g = `https://graph.facebook.com/${v}`;
  // Short-lived user token (from the Graph API Explorer) -> long-lived user token -> Page token, which does not expire.
  const { body: long } = await request(`${g}/oauth/access_token`, {
    method: "POST",
    body: form({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: env.META_USER_TOKEN.trim() }),
  }, "Meta long-lived token");
  const { body: pages } = await request(`${g}/me/accounts?fields=name,access_token,instagram_business_account{id,username}`, {
    headers: { Authorization: `Bearer ${long.access_token}` },
  }, "Meta page list");
  const linked = (pages.data ?? []).filter((p) => p.instagram_business_account);
  const want = env.META_PAGE_NAME?.trim();
  const page = want ? linked.find((p) => p.name === want) : linked.length === 1 ? linked[0] : null;
  if (!page) {
    throw new Error(linked.length
      ? `more than one Page has an Instagram account (${linked.map((p) => p.name).join(", ")}); run again with the page name filled in`
      : "no Facebook Page with a linked Instagram professional account was found for this login (check the permissions you ticked in the Explorer)");
  }
  saveSecret(env, "INSTAGRAM_USER_ID", page.instagram_business_account.id);
  saveSecret(env, "INSTAGRAM_ACCESS_TOKEN", page.access_token);
  console.log(`Instagram connected: @${page.instagram_business_account.username} through the Page "${page.name}". INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN saved.`);
  return 0;
}

// ---- main ----------------------------------------------------------------------------------------

const cmd = process.argv[2] ?? "status";
const commands = {
  plan: () => { makePlan(); return 0; },
  run,
  check,
  status,
  validate: () => {
    const p = validate({ files: !process.argv.includes("--no-files") });
    console.log(p.length ? p.map((x) => `- ${x}`).join("\n") : `config.json and queue.json look right (${queue.items?.length ?? 0} videos).`);
    return p.length ? 1 : 0;
  },
  "connect-tiktok-link": tiktokLink,
  "connect-tiktok": connectTiktok,
  "connect-instagram": connectInstagram,
};
if (!commands[cmd]) { console.error(`unknown command "${cmd}"; use ${Object.keys(commands).join(", ")}`); process.exit(2); }
try {
  process.exitCode = await commands[cmd]();
} catch (e) {
  console.error(`Autopost ${cmd} failed: ${e.message}`);
  process.exitCode = 1;
}
