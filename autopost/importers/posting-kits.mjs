#!/usr/bin/env node
// Adds videos made with the animated-short skill to queue.json. Each video folder has
// export/short.mp4, export/cover.png and export/posting.md (the captions per app), and notes.md
// with its checks. Only videos whose Export check is ticked are added, oldest first (folder date, then episode number); videos
// already in the queue are left alone, so it is safe to run again after new exports.
//
//   node autopost/importers/posting-kits.mjs <videos folder> [--queue autopost/queue.json] [--include-unticked] [--mark-posted]
//
// --mark-posted marks the videos it adds as already posted (by hand, before autopost), so only videos
// exported after that get posted.
//
// The paths written are relative to config.json's mediaRoot, which should point at the videos folder.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const videosDir = args.find((a) => !a.startsWith("--"));
if (!videosDir) { console.error("usage: posting-kits.mjs <videos folder> [--queue file] [--include-unticked]"); process.exit(2); }
const qi = args.indexOf("--queue");
const queuePath = resolve(qi >= 0 ? args[qi + 1] : "autopost/queue.json");
const includeUnticked = args.includes("--include-unticked");
const markPosted = args.includes("--mark-posted");

// The text inside the ```text box that follows **Label** in one ## section of posting.md.
function box(md, section, label) {
  const s = md.split(/^## /m).find((x) => x.startsWith(section));
  if (!s) return null;
  const m = new RegExp(`\\*\\*${label}\\*\\*[^\\n]*\\n+\`\`\`text\\n([\\s\\S]*?)\\n\`\`\``).exec(s);
  return m ? m[1] : null;
}

const queue = existsSync(queuePath) ? JSON.parse(readFileSync(queuePath, "utf8")) : { items: [] };
const have = new Set(queue.items.map((i) => i.id));
const added = [], skipped = [];

// Oldest first: by the folder's date, then by episode number (videos with none first), then by name.
const episode = (name) => {
  const p = join(videosDir, name, "notes.md");
  const m = existsSync(p) && /^Episode: (\d+)/m.exec(readFileSync(p, "utf8"));
  return m ? Number(m[1]) : -1;
};
const order = readdirSync(videosDir).map((n) => ({ n, d: n.slice(0, 10), e: episode(n) }))
  .sort((a, b) => a.d.localeCompare(b.d) || a.e - b.e || a.n.localeCompare(b.n)).map((x) => x.n);

for (const name of order) {
  const dir = join(videosDir, name);
  const kit = join(dir, "export", "posting.md");
  const notesPath = join(dir, "notes.md");
  if (!existsSync(kit) || !existsSync(join(dir, "export", "short.mp4"))) continue;
  if (have.has(name)) continue;
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8") : "";
  if (!includeUnticked && !/^- \[x\] Export/m.test(notes)) { skipped.push(`${name} (Export not ticked)`); continue; }
  const md = readFileSync(kit, "utf8");
  const item = { id: name, video: `${name}/export/short.mp4` };
  if (markPosted) item.posted = "by hand, before autopost";
  if (existsSync(join(dir, "export", "cover.png"))) item.cover = `${name}/export/cover.png`;
  const at = /cover from (\d+(?:\.\d+)?) ?s/.exec(notes);
  if (at) item.coverAtSeconds = Number(at[1]);
  const ytTitle = box(md, "YouTube", "Title");
  if (ytTitle) item.youtube = { title: ytTitle, description: box(md, "YouTube", "Description") ?? "" };
  const ig = box(md, "Instagram", "Caption");
  if (ig) item.instagram = { caption: ig };
  const tt = box(md, "TikTok", "Caption");
  if (tt) item.tiktok = { caption: tt };
  queue.items.push(item);
  added.push(name);
}

writeFileSync(queuePath, JSON.stringify(queue, null, 2) + "\n");
console.log(`Added ${added.length} videos to ${queuePath} (now ${queue.items.length}).`);
if (skipped.length) console.log(`Left out:\n${skipped.map((s) => `  ${s}`).join("\n")}`);
