# auto-poster

Have AI post approved content 3 to 6 times a day.

Posts short vertical videos to **YouTube Shorts**, **Instagram Reels** and **TikTok** on a schedule, from a queue you keep in this repository. It runs on GitHub Actions, so it costs nothing to host and needs no computer left on. It uses each app's own official API, with your own developer apps, so no third-party service ever holds your logins.

Make your own copy with **Use this template** (top of this page), keep it **private**, and follow "Set up" below.

## How it works

1. **The queue.** `autopost/queue.json` lists the videos in the order they post. Each one names its MP4, an optional cover, and the words for each app (YouTube title and description, Instagram caption, TikTok caption).
2. **The schedule.** `autopost/config.json` holds the posting times as local clock times in your time zone, per weekday (for example 11:00 and 19:00, and three times on Fridays).
3. **The job.** `.github/workflows/autopost.yml` wakes up every hour. If a posting time has come (in the last three hours) and is not used yet, it posts the next video in the queue to each app that is set up, then records it.
4. **The log.** What posted, where, and the links, is saved to `log.json` on a branch of its own, `autopost-log`, so your main branch only changes when you change it. A video is never posted twice: the log is written after each app.
5. **When something fails,** the run goes red, GitHub emails you, and the app that failed is tried again on the next hour, up to three times. The other apps are not posted again.

## Nothing posts until you say so

The repository variable **`AUTOPOST_MODE`** decides what the job does:

| Mode | What happens |
| --- | --- |
| *(not set)* or `dry-run` | **The default.** Says what it would post and where, posts nothing. |
| `off` | **Paused.** Does nothing at all. |
| `test` | Posts privately: YouTube as a private video, TikTok to your inbox as a draft. Instagram is skipped (it has no private posts). Test mode keeps its own place in the queue, so it never uses up a real post. |
| `live` | Posts for real, as `config.json` says. |

To set it: your repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**, name `AUTOPOST_MODE`, value `live` (or `off`, and so on). This works from a phone browser.

Other ways to pause: turn the workflow off (**Actions** → **Autopost** → **⋯** → **Disable workflow**), or hold one video by adding `"hold": true` to it in the queue.

## Where your keys and logins go (never in the repository)

Keys, passwords and tokens **never** go in a file in this repository, in an issue, a pull request, a commit message, or a chat. Git keeps every old version of every file, so a key committed once stays readable even after you delete it.

They go in **GitHub's encrypted Actions secrets**: your repository → **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab → **New repository secret**. A secret can be replaced but never read back, not even by you; it is only handed to the workflow while it runs, and GitHub blanks it out (`***`) if it ever appears in a log. People who can only read the repository, and pull requests from forks, never get them.

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Your Google OAuth client | [docs/youtube.md](docs/youtube.md) |
| `YOUTUBE_REFRESH_TOKEN` | Lets the job upload to your channel | [docs/youtube.md](docs/youtube.md) |
| `META_APP_ID`, `META_APP_SECRET` | Your Meta developer app | [docs/instagram.md](docs/instagram.md) |
| `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` | Your Instagram account and its token | Saved for you by the connect step, [docs/instagram.md](docs/instagram.md) |
| `TIKTOK_CLIENT_SECRET` | Your TikTok developer app | [docs/tiktok.md](docs/tiktok.md) |
| `TIKTOK_REFRESH_TOKEN` | Lets the job send videos to your TikTok | Saved for you by the connect step, [docs/tiktok.md](docs/tiktok.md) |
| `AUTOPOST_ADMIN_TOKEN` | Lets the connect step save the secrets above, and keeps the TikTok token fresh | "The admin token" below |

Two values are not secret and go under the **Variables** tab instead: `TIKTOK_CLIENT_KEY` and `TIKTOK_REDIRECT_URI` (they appear in TikTok's sign-in link anyway).

A few more rules worth keeping:

- **Keep the repository private.** The secrets are safe either way, but the posting log and the run pages show what you post and when.
- **Copy a value straight from the app's page into GitHub's secret box.** Don't paste it into notes, chats or email on the way.
- **Your own app passwords are never needed.** Each app gives the job a token through its own sign-in page; you can cut it off at any time from the app's settings (Google: myaccount.google.com → Security → Third-party connections; Facebook: Settings → Business integrations; TikTok: Settings → Security → Manage app permissions).
- **If a secret might have leaked,** make a new one in the app it came from, save it over the old secret, and delete the old one in the app.
- **Running it on your own computer** (optional, for developers): put the values in a file named `.env` in the repository folder and run `node --env-file=.env autopost/autopost.mjs check`; `.gitignore` already keeps `.env` out of git. Or set them in your shell. Never in `config.json` or `queue.json`.
- **In an organization:** an owner can set the secrets once at the organization level (Organization settings → Secrets and variables → Actions) and choose which repositories get them, so team members never handle the keys at all.

### The admin token

The connect steps for Instagram and TikTok trade a short-lived sign-in code for long-lived tokens and save them as secrets for you, and the posting job saves TikTok's token again whenever TikTok renews it. Writing a secret needs a token that may do that:

1. GitHub → your picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name `autopost`, expiration up to a year, **Repository access: Only select repositories** → this repository.
3. **Permissions → Repository permissions → Secrets: Read and write.** Nothing else.
4. **Generate token**, copy it, and save it straight away as the secret `AUTOPOST_ADMIN_TOKEN` in this repository. (In an organization, an owner may have to approve the token first.)

It can only change this one repository's secrets; it cannot read them, read your code or post anywhere.

## Set up

1. **Make the repository:** Use this template → private.
2. **Add videos:** put each video in `media/` (one folder per video is tidy: `media/my-video/video.mp4` and `cover.png`), and list it in `autopost/queue.json` (the example item there shows every field; delete it when you add yours). Or keep the videos where they already are; see "Using it in a repository that already has your videos".
3. **Set your times:** edit `timezone` and `slots` in `autopost/config.json`.
4. **Connect the apps you want,** one at a time: [YouTube](docs/youtube.md), [Instagram](docs/instagram.md), [TikTok](docs/tiktok.md). An app that isn't set up is skipped with a note, so you can start with one.
5. **Check it:** **Actions** → **Autopost** → **Run workflow** → action `check`. It signs in to each app and names the account it would post to.
6. **Try it:** run it with action `post-now` and mode `dry-run`, then `test`. Look at the run's summary page.
7. **Go live:** set `AUTOPOST_MODE` to `live`.

## Running it by hand

**Actions** → **Autopost** → **Run workflow**:

- **action** `post-if-due` (what the hourly run does), `post-now` (post the next video now, whatever the time), `check` (sign-ins), `status` (what has posted, what's next, the next times).
- **mode** `setting` uses `AUTOPOST_MODE`; the others override it for this one run.

Each run's summary page lists what it posted, with links. For TikTok in inbox mode it also shows the caption to paste.

## The queue file

```json
{
  "id": "unique-name",
  "video": "unique-name/video.mp4",
  "cover": "unique-name/cover.png",
  "coverAtSeconds": 2.5,
  "hold": false,
  "posted": "",
  "platforms": ["youtube", "tiktok"],
  "youtube": { "title": "Up to 100 characters", "description": "...", "tags": ["optional"] },
  "instagram": { "caption": "Up to 2200 characters, 30 hashtags" },
  "tiktok": { "caption": "Up to 2200 characters" }
}
```

Paths are relative to `mediaRoot` in `config.json` (default `media`). Only `id` and `video` are required. `hold: true` keeps a video back for now; `posted` (any text, such as `"by hand"`) marks one you already posted yourself, so it is skipped for good. Leave out an app's block, or list `platforms`, to skip an app for that video. `coverAtSeconds` picks the cover frame on Instagram and TikTok (neither takes an uploaded image through this route); YouTube uses `cover` only if `setThumbnail` is on. Videos post in the order they appear; to change the order, move them. `node autopost/autopost.mjs validate` checks the file.

## Using it in a repository that already has your videos

Copy the `autopost/` folder and the two files in `.github/workflows/` into that repository, and set `mediaRoot` in `config.json` to the folder that holds the videos (for example `videos`). The job checks out only the one video it is posting, so a repository with gigabytes of video stays quick.

`autopost/importers/posting-kits.mjs` fills the queue from folders made with the animated-short skill (each with `export/short.mp4`, `export/cover.png` and `export/posting.md`), oldest first, and only those whose Export check is ticked. It skips videos already in the queue, so you can run it again after each new batch. Add `--mark-posted` the first time if those videos are already up, so only the ones exported later get posted.

## Limits worth knowing

- **TikTok** only lets an app post straight to your profile after TikTok audits it; before that, direct posts must be private and the account itself private. So the default here is **inbox mode**: the video arrives in your TikTok inbox as a draft and you tap the notification to post it (the run summary has the caption to paste). Switch `method` to `direct` once your app passes the audit. At most 5 drafts can wait in the inbox per 24 hours.
- **YouTube** gives a new Google Cloud project a daily upload allowance that is plenty for a few videos a day. If a video comes up private when you asked for public, the run says so; Google can restrict apps it hasn't reviewed (there is an audit form linked from the YouTube API docs).
- **Instagram** allows a limited number of API posts per day (100 at the time of writing), far above this schedule. Vertical 9:16 video is what Reels expect.
- **GitHub** gives private repositories 2,000 free Actions minutes a month. The hourly check takes well under a minute; a post takes a few. GitHub may start scheduled runs late at busy times (that's why a time stays open for three hours) and, in public repositories, turns schedules off after 60 days without activity.
- The API details here were checked against each app's documentation in November 2026. Apps change their APIs; if something stops working, the run's error message says which call failed and what the app answered.

## Files

```
autopost/
  autopost.mjs          the job: plan, run, check, status, validate, connect steps
  config.json           time zone, posting times, per-app settings
  queue.json            the videos, in posting order
  lib/                  one file per app, plus the schedule and helpers
  importers/            fill the queue from other formats
.github/workflows/
  autopost.yml          the hourly job
  autopost-connect.yml  one-time sign-in for TikTok and Instagram
docs/                   setup for each app
media/                  your videos (or point mediaRoot elsewhere)
```

No packages to install: it is plain Node.js 22 using only what Node comes with.
