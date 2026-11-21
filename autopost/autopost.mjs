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
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dueSlot, upcomingSlots, validateSlots, localParts, aheadSlots, slotTime } from "./lib/schedule.mjs";
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

// ---- accounts ------------------------------------------------------------------------------------
// config.accounts names each channel set, e.g. { "main": {}, "second": { "slots": {...}, "platforms": {...} } }.
// The first account uses the plain secret names (YOUTUBE_REFRESH_TOKEN); every other account adds its name
// in capitals (YOUTUBE_REFRESH_TOKEN_SECOND). App keys (client ids and secrets) may be shared: an account
// without its own falls back to the plain ones. Account tokens never fall back, so a video can't reach the
// wrong channel. A queue item picks its account with "account"; without it, it goes to the first account.
const accounts = () => config.accounts ?? { main: {} };
const firstAccount = () => Object.keys(accounts())[0];
const accountOf = (item) => item.account ?? firstAccount();
const suffixOf = (acct) => (acct === firstAccount() ? "" : "_" + acct.toUpperCase().replace(/[^A-Z0-9]/g, "_"));
const PER_ACCOUNT = ["YOUTUBE_REFRESH_TOKEN", "INSTAGRAM_USER_ID", "INSTAGRAM_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN"];
const SHAREABLE = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "META_APP_ID", "META_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"];

function allValues() {
  // The workflow hands over every repository secret and variable as JSON, so new accounts need no workflow edit.
  const parse = (v) => { try { return v ? JSON.parse(v) : {}; } catch { return {}; } };
  const out = { ...parse(env.AUTOPOST_VARS), ...parse(env.AUTOPOST_SECRETS) };
  for (const [k, v] of Object.entries(env)) if (v && /^(YOUTUBE|INSTAGRAM|TIKTOK|META)_/.test(k)) out[k] = v;
  return out;
}

// The environment one account's posts run with: its own tokens under the plain names.
function envFor(acct) {
  if (!accounts()[acct]) throw new Error(`account "${acct}" is not in config.json's accounts`);
  const all = allValues();
  const sfx = suffixOf(acct);
  const e = { ...env, AUTOPOST_SECRET_SUFFIX: sfx, AUTOPOST_ACCOUNT_NAME: acct };
  for (const k of [...PER_ACCOUNT, ...SHAREABLE]) {
    const v = all[k + sfx] || (sfx && SHAREABLE.includes(k) ? all[k] : undefined) || (!sfx ? all[k] : undefined);
    if (v) e[k] = v; else delete e[k];
  }
  return e;
}
const optsFor = (acct, name) => ({ ...(config.platforms?.[name] ?? {}), ...(accounts()[acct]?.platforms?.[name] ?? {}) });
const scheduleFor = (acct) => ({ ...config, slots: accounts()[acct]?.slots ?? config.slots });
const entryAccount = (p) => p.account ?? firstAccount();

const mediaPath = (rel) => (rel ? resolve(ROOT, config.mediaRoot ?? "media", rel) : null);

// `posted` marks what was posted by hand before autopost: true or any text = every app, a list = those apps.
const postedBy = (item, name) => Array.isArray(item.posted) ? item.posted.includes(name) : Boolean(item.posted);
const allPosted = (item) => Object.keys(PLATFORMS).filter((n) => optsFor(accountOf(item), n).enabled).every((n) => postedBy(item, n));

// Which platforms an item goes to, and why any are left out.
function platformsFor(item, m, aenv) {
  const on = [], off = [];
  const acct = accountOf(item);
  for (const [name, mod] of Object.entries(PLATFORMS)) {
    const opts = optsFor(acct, name);
    if (!opts.enabled) { off.push(`${name}: turned off in config.json`); continue; }
    if (item.platforms && !item.platforms.includes(name)) { off.push(`${name}: not in this item's platforms`); continue; }
    if (postedBy(item, name)) { off.push(`${name}: already posted by hand`); continue; }
    if (!item[name]) { off.push(`${name}: no ${name} words in queue.json`); continue; }
    const sfx = suffixOf(acct);
    const missing = mod.SECRETS.filter((s) => !aenv[s]).map((s) => (PER_ACCOUNT.includes(s) ? s + sfx : s));
    if (missing.length) {
      if (m !== "dry-run") { off.push(`${name}: secrets not set (${missing.join(", ")})`); continue; }
      off.push(`${name}: listed above as a preview, but its secrets are not set yet (${missing.join(", ")})`);
    }
    if (m === "test" && name === "instagram") { off.push("instagram: skipped in test mode (Instagram has no private posts)"); continue; }
    on.push(name);
  }
  return { on, off };
}

// Each app keeps its own place in the queue: an item is finished on an app once the log has a post
// there (or it gave up after maxAttempts), so an app set up later still gets the videos the others
// already posted.
const entryFor = (log, m, id) => log.posts.find((p) => p.id === id && p.mode === logMode(m));
const doneOn = (entry, name) => { const r = entry?.results?.[name]; return Boolean(r && (r.ok || r.attempts >= MAX_ATTEMPTS)); };
function owed(item, m, log) {
  const entry = entryFor(log, m, item.id);
  // A dry run previews apps whose secrets are missing, but only for videos nothing has posted yet.
  const { on, off } = platformsFor(item, m === "dry-run" && entry ? "live" : m, envFor(accountOf(item)));
  return { on: on.filter((n) => !doneOn(entry, n)), off: [...off, ...on.filter((n) => doneOn(entry, n)).map((n) => `${n}: already posted by autopost`)], entry };
}

// ---- validate ------------------------------------------------------------------------------------

function validate({ files = true } = {}) {
  const problems = [];
  try { validateSlots(config.slots ?? {}); } catch (e) { problems.push(e.message); }
  for (const [name, a] of Object.entries(accounts())) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) problems.push(`account name "${name}": use letters, digits, - or _`);
    if (a.slots) try { validateSlots(a.slots); } catch (e) { problems.push(`account ${name}: ${e.message}`); }
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }); } catch { problems.push(`config.timezone "${config.timezone}" is not a time zone name (example: America/Chicago)`); }
  const seen = new Set();
  for (const [i, it] of (queue.items ?? []).entries()) {
    const at = `queue item ${i + 1} (${it.id ?? "no id"})`;
    if (!it.id) problems.push(`${at}: needs an id`);
    if (seen.has(it.id)) problems.push(`${at}: the id is used twice`);
    seen.add(it.id);
    if (!it.video) problems.push(`${at}: needs a video`);
    if (it.account && !accounts()[it.account]) problems.push(`${at}: account "${it.account}" is not in config.json's accounts`);
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
      if (it.overlay && !existsSync(join(HERE, it.overlay))) problems.push(`${at}: overlay file not found: autopost/${it.overlay}`);
      const v = mediaPath(it.video);
      if (v && existsSync(v) && statSync(v).size > 1024 ** 3) problems.push(`${at}: video is over 1 GB`);
    }
  }
  return problems;
}

// ---- plan ----------------------------------------------------------------------------------------

// `only` limits it to items still owed to those apps.
function nextItem(log, m, acct, skip = new Set(), only = null) {
  return (queue.items ?? []).find((it) => (!acct || accountOf(it) === acct) && !it.hold && !skip.has(it.id)
    && owed(it, m, log).on.some((n) => !only || only.includes(n))) ?? null;
}

// Uploading ahead: YouTube can hold a private upload and make it public at a set time, so posts land on
// the minute even when GitHub starts the job late or skips it. The other apps can't be scheduled this way,
// so they keep their own place and post when a run finds a slot due. Returns hours ahead to fill (0 = off).
const MAX_PER_RUN = 4; // YouTube's free quota is about six uploads a day
function aheadHours(acct, m) {
  if (m !== "live" && m !== "dry-run") return 0;
  return optsFor(acct, "youtube").enabled ? Number(optsFor(acct, "youtube").scheduleAheadHours ?? 0) : 0;
}
// Every slot an account has used, counting each app's post (an app can catch up in a later slot);
// with `names`, only the slots those apps used.
const usedSlots = (log, m, acct, names = null) => new Set(log.posts.filter((p) => p.mode === logMode(m) && entryAccount(p) === acct)
  .flatMap((p) => names
    ? Object.entries(p.results).filter(([n]) => names.includes(n)).map(([, r]) => r.slot ?? p.slot)
    : [p.slot, ...Object.values(p.results).map((r) => r.slot)]).filter(Boolean));

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
    if (retry && m !== "dry-run") {
      plan = { ...plan, job: "retry", id: retry.id, account: entryAccount(retry), why: `retrying what failed on ${retry.id}` };
    } else if (postNow) {
      const only = env.AUTOPOST_ACCOUNT?.trim() || null;
      const item = nextItem(log, m, only);
      if (!item) plan.why = `nothing left to post${only ? ` for account ${only}` : ""}: add videos to queue.json`;
      else plan = { ...plan, job: "post", id: item.id, account: accountOf(item), slot: `manual ${now.toISOString()}`, why: "posting now (run by hand)" };
    } else {
      // Each account keeps its own times and its own place in the queue. A run posts what is due, plus,
      // when uploading ahead, the coming slots' videos (all for one account per run).
      const waiting = [];
      for (const acct of Object.keys(accounts())) {
        const sched = scheduleFor(acct);
        const jobs = [];
        // With upload-ahead, YouTube is its own lane (uploaded early) and the other apps another (posted when due).
        const hours = aheadHours(acct, m);
        const apps = Object.keys(PLATFORMS).filter((n) => optsFor(acct, n).enabled);
        const lanes = hours ? [["youtube"], apps.filter((n) => n !== "youtube")] : [null];
        let anyDue = false;
        for (const only of lanes) {
          if (only && !only.length) continue;
          const used = usedSlots(log, m, acct, only);
          const chosen = new Set();
          const slot = dueSlot(now, sched, used);
          if (slot) {
            anyDue = true;
            const item = nextItem(log, m, acct, chosen, only);
            if (item) { jobs.push({ job: "post", id: item.id, account: acct, slot, only, why: `${acct} slot ${slot} is due${only ? ` (${only.join(", ")})` : ""}` }); chosen.add(item.id); }
            else waiting.push(`${acct}: slot ${slot} is due but nothing is left to post${only ? ` to ${only.join(", ")}` : ""}`);
          }
          if (hours && only?.[0] === "youtube") {
            for (const s of aheadSlots(now, sched, used, hours)) {
              if (jobs.length >= MAX_PER_RUN) break;
              const item = nextItem(log, m, acct, chosen, only);
              if (!item) break;
              jobs.push({ job: "post", id: item.id, account: acct, slot: s, only, publishAt: slotTime(s, sched.timezone).toISOString(), why: `uploaded ahead, goes public at ${s}` });
              chosen.add(item.id);
            }
          }
        }
        const slot = anyDue;
        if (!jobs.length) { if (!slot) waiting.push(`${acct} next ${upcomingSlots(now, sched, 1)[0] ?? "none set"}`); continue; }
        plan = { ...plan, ...jobs[0], more: jobs.slice(1) };
        break;
      }
      if (plan.job === "none") plan.why = `no slot due (${localParts(now, config.timezone).ymd}, ${config.timezone}); ${waiting.join("; ")}`;
    }
  }
  if (plan.id) {
    const items = [plan.id, ...(plan.more ?? []).map((j) => j.id)].map((id) => queue.items.find((it) => it.id === id));
    plan.dirs = [...new Set(items.flatMap((item) => [item.video, item.cover]).filter(Boolean).map((r) => dirname(join(config.mediaRoot ?? "media", r))))];
  }
  writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2));
  output("job", plan.job);
  output("dirs", (plan.dirs ?? []).join("\n"));
  console.log(`Mode ${m}: ${plan.job === "none" ? "nothing to do" : plan.job + " " + plan.id}. ${plan.why}`);
  for (const j of plan.more ?? []) console.log(`  and ${j.id}: ${j.why}`);
  return plan;
}

// ---- run -----------------------------------------------------------------------------------------

async function postTo(name, item, files, m, aenv, publishAt) {
  const opts = optsFor(accountOf(item), name);
  if (name === "youtube") return youtube.post(item, files, opts, aenv, m === "test" ? "private" : (opts.privacy ?? "public"), publishAt);
  if (name === "instagram") return instagram.post(item, files, opts, aenv);
  if (name === "tiktok") {
    const privacy = m === "test" ? "SELF_ONLY" : (opts.privacy ?? "PUBLIC_TO_EVERYONE");
    return tiktok.post(item, files, opts, aenv, privacy);
  }
}

async function run() {
  const plan = existsSync(PLAN_PATH) ? readJson(PLAN_PATH) : makePlan();
  rmSync(PLAN_PATH, { force: true }); // a plan is used once
  if (plan.job === "none") return 0;
  let failed = 0;
  for (const job of [plan, ...(plan.more ?? [])]) failed += await runOne({ ...job, mode: plan.mode });
  return failed ? 1 : 0;
}

// An ffmpeg filter that draws `text` in a bordered box, sized for a 1080x1920 video by default. The font
// should be monospaced (the wrap counts characters); the default is on GitHub's Ubuntu runners.
function textBoxFilter(text, id) {
  const o = { font: "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", charWidth: 0.602, left: 50, right: 50, top: 1450, bottom: 1700,
    maxSize: 44, minSize: 24, color: "#f5ecd7", box: "#0a0a0e", boxOpacity: 0.82, border: 5, ...(config.onScreenText ?? {}) };
  const width = 1080 - o.left - o.right, pad = 24;
  const wrap = (size) => {
    const per = Math.max(8, Math.floor((width - 2 * pad - 2 * o.border) / (size * o.charWidth)));
    const lines = [];
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const last = lines.at(-1);
      if (last !== undefined && (last + " " + word).length <= per) lines[lines.length - 1] = last + " " + word;
      else lines.push(word);
    }
    return lines;
  };
  let size = o.maxSize, lines = wrap(size);
  while (size > o.minSize && o.top + lines.length * size * 1.6 + 2 * pad > o.bottom) lines = wrap(size -= 2);
  const lh = Math.round(size * 1.6), h = lines.length * lh + 2 * pad;
  const hex = (c) => "0x" + c.replace("#", "");
  const parts = [
    `drawbox=x=${o.left}:y=${o.top}:w=${width}:h=${h}:color=${hex(o.box)}@${o.boxOpacity}:t=fill`,
    `drawbox=x=${o.left}:y=${o.top}:w=${width}:h=${h}:color=${hex(o.color)}:t=${o.border}`,
  ];
  lines.forEach((line, i) => {
    const file = join(tmpdir(), `autopost-${id}-line${i}.txt`);
    writeFileSync(file, line);
    parts.push(`drawtext=fontfile='${o.font}':textfile='${file}':fontsize=${size}:fontcolor=${hex(o.color)}:x=(w-text_w)/2:y=${o.top + pad + i * lh + Math.round((lh - size) / 2)}`);
  });
  return parts.join(",");
}

async function runOne(plan) {
  const m = plan.mode;
  const item = queue.items.find((it) => it.id === plan.id);
  const files = { video: mediaPath(item.video), cover: mediaPath(item.cover) };
  const problems = validate({ files: true }).filter((p) => p.includes(`(${item.id})`));
  if (problems.length) { summary(`### Autopost: can't post ${item.id}\n\n${problems.map((p) => `- ${p}`).join("\n")}`); return 1; }

  const acct = accountOf(item);
  const aenv = envFor(acct);
  const log = readLog();
  let { on, off, entry } = owed(item, m, log);
  const targets = plan.job === "retry"
    ? Object.entries(entry.results).filter(([, r]) => !r.ok && r.attempts < MAX_ATTEMPTS).map(([n]) => n)
    : on.filter((n) => !plan.only || plan.only.includes(n));

  if (m === "dry-run") {
    const size = (statSync(files.video).size / 1048576).toFixed(1);
    summary([
      `### Autopost dry run: would post \`${item.id}\` to account ${acct} (${plan.why})`, "",
      `Video: ${config.mediaRoot ?? "media"}/${item.video} (${size} MB)`,
      ...on.map((n) => `- **${n}**: ${n === "youtube" ? `"${item.youtube.title}" as ${plan.publishAt ? `private until ${plan.publishAt}, then public` : (optsFor(acct, "youtube").privacy ?? "public")}` : n === "tiktok" ? `via ${optsFor(acct, "tiktok").method ?? "inbox"}` : "reel"}`),
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
  // A retried upload keeps its publish time while that is still ahead; otherwise it goes up straight away.
  if (plan.job === "retry" && entry?.publishAt && Date.parse(entry.publishAt) > Date.now() + 10 * 60000) plan.publishAt = entry.publishAt;
  // On-screen extras, laid over the video as it goes up (the video file in the repository stays as it is):
  // "onScreenText" draws a text box, for example the hook, the whole video long (style: config.onScreenText);
  // "overlay" is a PNG in autopost/ the size of the video, transparent except what it adds.
  if (item.overlay || item.onScreenText) {
    const out = join(tmpdir(), `autopost-${item.id}.mp4`);
    const args = ["-v", "error", "-y", "-i", files.video];
    let chain = "[0:v]";
    if (item.onScreenText) chain += textBoxFilter(item.onScreenText, item.id) + ",";
    if (item.overlay) { args.push("-i", join(HERE, item.overlay)); chain = chain.replace(/,?$/, "[t];[t][1:v]overlay,"); }
    args.push("-filter_complex", chain.replace(/,$/, "") + "[v]", "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", out);
    execFileSync("ffmpeg", args);
    files.video = out;
  }
  if (!entry) {
    entry = { id: item.id, account: acct, slot: plan.slot, mode: logMode(m), at: new Date().toISOString(), results: {}, skipped: off, ...(plan.publishAt ? { publishAt: plan.publishAt } : {}) };
    log.posts.push(entry);
  }

  let failed = 0;
  const lines = [`### Autopost (${m}): ${item.id} to account ${acct}`, ""];
  for (const name of targets) {
    const prev = entry.results[name] ?? { attempts: 0 };
    try {
      const r = await postTo(name, item, files, m, aenv, name === "youtube" ? plan.publishAt : undefined);
      entry.results[name] = { ok: true, attempts: prev.attempts + 1, at: new Date().toISOString(), slot: prev.slot ?? plan.slot, ...r };
      lines.push(`- **${name}**: ${r.publishAt ? `uploaded, goes public ${r.publishAt}` : "posted"}${r.url ? ` ${r.url}` : ""}${r.note ? ` (${r.note})` : ""}`);
    } catch (e) {
      failed++;
      entry.results[name] = { ok: false, attempts: prev.attempts + 1, at: new Date().toISOString(), slot: prev.slot ?? plan.slot, error: e.message.slice(0, 1000) };
      const more = prev.attempts + 1 < MAX_ATTEMPTS ? "will try again next hour" : "gave up after " + MAX_ATTEMPTS + " tries";
      lines.push(`- **${name}**: FAILED, ${more}: ${e.message.slice(0, 500)}`);
    }
    writeLog(log); // after each platform, so a crash never makes it post twice
  }
  for (const o of off) lines.push(`- left out: ${o}`);
  if (targets.includes("tiktok") && (optsFor(acct, "tiktok").method ?? "inbox") === "inbox" && entry.results.tiktok?.ok) {
    lines.push("", "TikTok caption to paste:", "", "```text", item.tiktok.caption, "```");
  }
  writeLog(log);
  summary(lines.join("\n"));
  return failed ? 1 : 0;
}

// ---- check / status ------------------------------------------------------------------------------

async function check() {
  let bad = 0;
  for (const acct of Object.keys(accounts())) {
    const aenv = envFor(acct);
    const sfx = suffixOf(acct);
    console.log(`Account ${acct}${sfx ? ` (secrets end in ${sfx})` : ""}:`);
    for (const [name, mod] of Object.entries(PLATFORMS)) {
      const opts = optsFor(acct, name);
      const missing = mod.SECRETS.filter((s) => !aenv[s]).map((s) => (PER_ACCOUNT.includes(s) ? s + sfx : s));
      if (!opts.enabled) { console.log(`  ${name}: turned off`); continue; }
      if (missing.length) { console.log(`  ${name}: not set up yet (missing: ${missing.join(", ")})`); continue; }
      try { console.log(`  ${name}: OK, ${await mod.check(aenv, opts)}`); }
      catch (e) { bad++; console.log(`  ${name}: FAILED: ${e.message}`); }
    }
  }
  return bad ? 1 : 0;
}

function status() {
  const m = mode();
  const log = readLog();
  const mine = log.posts.filter((p) => p.mode === logMode(m));
  const lines = [`### Autopost status (mode ${m})`, ""];
  for (const acct of Object.keys(accounts())) {
    const items = (queue.items ?? []).filter((it) => accountOf(it) === acct);
    const left = items.filter((it) => !it.hold && owed(it, m, log).on.length);
    lines.push(
      `**Account ${acct}**: posted ${mine.filter((p) => entryAccount(p) === acct).length} by autopost, ${items.filter(allPosted).length} marked as posted by hand on every app. Left: ${left.length}. On hold: ${items.filter((i) => i.hold).length}.`,
      `Next up: ${left.slice(0, 3).map((i) => i.id).join(", ") || "nothing"}`,
      `Next times (${config.timezone}): ${upcomingSlots(new Date(), scheduleFor(acct), 5).join("; ")}`, "",
    );
  }
  summary([
    ...lines,
    ...mine.slice(-5).map((p) => `- ${p.id} (${entryAccount(p)}, ${p.slot}): ${Object.entries(p.results).map(([n, r]) => `${n} ${r.ok ? "ok" : "failed"}`).join(", ") || "nothing posted"}`),
  ].join("\n"));
  return 0;
}

// ---- one-time connect steps ----------------------------------------------------------------------

// The connect steps work on one account: AUTOPOST_ACCOUNT (the "account" box), or the first account.
const connectEnv = () => {
  const acct = env.AUTOPOST_ACCOUNT?.trim() || firstAccount();
  const e = envFor(acct);
  for (const k of ["TIKTOK_CODE", "META_USER_TOKEN", "META_PAGE_NAME", "AUTOPOST_ADMIN_TOKEN", "GITHUB_REPOSITORY", "GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY"]) if (env[k]) e[k] = env[k];
  return e;
};

function tiktokLink() {
  const env = connectEnv();
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_REDIRECT_URI"]) if (!env[k]) throw new Error(`${k} is not set (README, "TikTok")`);
  const scope = (config.platforms?.tiktok?.method ?? "inbox") === "direct" ? "user.info.basic,video.publish" : "user.info.basic,video.upload";
  const appName = config.platforms?.tiktok?.appName ?? "autopost";
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.search = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY.trim(), scope, response_type: "code", redirect_uri: env.TIKTOK_REDIRECT_URI.trim(), state: `autopost~${env.AUTOPOST_ACCOUNT_NAME}~${env.GITHUB_REPOSITORY ?? ""}~${appName}` }).toString();
  const redirect = env.TIKTOK_REDIRECT_URI.trim();
  const page = redirect.endsWith("/connect.html")
    ? `\n\nThe sign-in page with its own "Sign in with TikTok" button (for TikTok's review video):\n\n${redirect}?${new URLSearchParams({ key: env.TIKTOK_CLIENT_KEY.trim(), account: env.AUTOPOST_ACCOUNT_NAME, repo: env.GITHUB_REPOSITORY ?? "", app: appName })}`
    : "";
  summary(`### TikTok sign-in link for account ${env.AUTOPOST_ACCOUNT_NAME}\n\nOpen this, sign in to the TikTok account to post to, and allow it:\n\n${u}\n\nYou land on ${env.TIKTOK_REDIRECT_URI.trim()} with \`?code=...\` in the address. Copy everything after \`code=\` up to the next \`&\`, then run "Autopost connect" again with app "tiktok", the same account, and paste it. The code works for a few minutes only.${page}`);
  return 0;
}

async function connectTiktok() {
  const env = connectEnv();
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_CODE", "TIKTOK_REDIRECT_URI"]) if (!env[k]) throw new Error(`${k} is not set`);
  const code = decodeURIComponent(env.TIKTOK_CODE.trim());
  const body = await tiktok.exchangeCode(env, code, env.TIKTOK_REDIRECT_URI.trim());
  saveSecret(env, "TIKTOK_REFRESH_TOKEN", body.refresh_token);
  console.log(`TikTok connected for account ${env.AUTOPOST_ACCOUNT_NAME}; TIKTOK_REFRESH_TOKEN${env.AUTOPOST_SECRET_SUFFIX} saved (good for about ${Math.round((body.refresh_expires_in ?? 31536000) / 86400)} days, renewed as it is used).`);
  return 0;
}

async function connectInstagram() {
  const env = connectEnv();
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
  const sfx = env.AUTOPOST_SECRET_SUFFIX;
  console.log(`Instagram connected for account ${env.AUTOPOST_ACCOUNT_NAME}: @${page.instagram_business_account.username} through the Page "${page.name}". INSTAGRAM_USER_ID${sfx} and INSTAGRAM_ACCESS_TOKEN${sfx} saved.`);
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
