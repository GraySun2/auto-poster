# TikTok setup

About 20 minutes in a web browser, plus TikTok's review if you want it beyond testing. You end with the secret `TIKTOK_CLIENT_SECRET` and the variables `TIKTOK_CLIENT_KEY` and `TIKTOK_REDIRECT_URI`, which you save, and the secret `TIKTOK_REFRESH_TOKEN`, which the connect step saves for you. Save the [admin token](../README.md#the-admin-token) first.

## How TikTok posting works here

TikTok offers two ways for an app to post:

- **Inbox (the default here).** The video lands in your TikTok inbox as a draft. You get a notification, tap it, paste the caption (it's on the run's summary page), and post. It needs the `video.upload` permission.
- **Direct.** The video goes straight to your profile with its caption. It needs the `video.publish` permission, and until TikTok has **audited** your app, direct posts can only be private (`SELF_ONLY`) and only on a private account. Switch to it (`"method": "direct"` in `config.json`) after the audit.

## Part 1: a TikTok developer app

1. Go to **developers.tiktok.com**, **Log in** with your TikTok account, and register as a developer if asked.
2. **Manage apps → Connect an app** (or **Create app**). Choose an individual developer if asked.
3. **Basic information:** an icon, name `autopost`, a category, a short description. For review TikTok also wants a website, a **Terms of Service** URL and a **Privacy Policy** URL; a page in this repository published with GitHub Pages works.
4. **Add products:** **Login Kit** and **Content Posting API**.
5. **Scopes:** `user.info.basic` and `video.upload` (add `video.publish` only for direct posting).
6. **Login Kit → Redirect URI → Web:** an https address you control, with no `?` in it. The repository's own address is fine, for example `https://github.com/your-name/your-repo`. TikTok sends you back there after you sign in, with a code in the address bar.
7. Save.

To try it before review, open **Sandbox** (top of the app page) → **Create sandbox**, give it the same products, scopes and redirect URI, and under **Target users → Add account** add your own TikTok account. A sandbox has its own client key and secret; use those while you test. To use it for real, submit the app for review.

## Part 2: save the app's keys

In your repository: **Settings → Secrets and variables → Actions**.

- **Variables** tab → `TIKTOK_CLIENT_KEY` = the **Client key** (not secret; it appears in the sign-in link).
- **Variables** tab → `TIKTOK_REDIRECT_URI` = the redirect URI from part 1, exactly as typed there.
- **Secrets** tab → `TIKTOK_CLIENT_SECRET` = the **Client secret** (copy it straight from TikTok's page).

## Part 3: sign in once

1. **Actions → Autopost connect → Run workflow** → app `tiktok-link`, leave the box empty (fill in **account** for any account but your first) → **Run workflow**.
2. Open the run → its summary shows a sign-in link. Open it, sign in to the TikTok account to post to, and **Authorize**.
3. TikTok sends you to your redirect address. In the address bar, copy everything after `code=` up to the next `&`.
4. Straight away (the code lasts a few minutes): **Actions → Autopost connect → Run workflow** → app `tiktok`, paste the code (and the same **account** as in step 1, if not your first) → **Run workflow**.
5. The run should end with `TikTok connected; TIKTOK_REFRESH_TOKEN saved`.

The token lasts about a year and is renewed whenever the job uses it (that's what the admin token is for). If you revoke the app in TikTok, repeat part 3.

## Part 4: check

**Actions → Autopost → Run workflow** → action `check`. It should say `tiktok: OK, signed in`.

## Settings in `autopost/config.json`

- `method`: `inbox` or `direct` (above).
- `privacy`: for direct posts only: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR` or `SELF_ONLY`. TikTok only allows what its creator-info check offers.
- `isAigc`: adds TikTok's "Creator labeled as AI-generated" tag (direct posts; in inbox mode you set it in the app).
- `disableComment`, `disableDuet`, `disableStitch`: direct posts only.

At most 5 inbox drafts may be waiting in any 24 hours, so post your drafts as they come in.

To cut the job off: TikTok → **Settings and privacy → Security & permissions → Apps and services** (or **Manage app permissions**) → `autopost` → **Remove access**.
