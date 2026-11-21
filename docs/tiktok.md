# TikTok setup

About 20 minutes in a web browser, plus TikTok's review if you want it beyond testing. You end with the secret `TIKTOK_CLIENT_SECRET` and the variables `TIKTOK_CLIENT_KEY` and `TIKTOK_REDIRECT_URI`, which you save, and the secret `TIKTOK_REFRESH_TOKEN`, which the connect step saves for you. Save the [admin token](../README.md#the-admin-token) first.

## How TikTok posting works here

TikTok offers two ways for an app to post:

- **Inbox (the default here).** The video lands in your TikTok inbox as a draft. You get a notification, tap it, paste the caption (it's on the run's summary page), and post. It needs the `video.upload` permission.
- **Direct.** The video goes straight to your profile with its caption. It needs the `video.publish` permission, and until TikTok has **audited** your app, direct posts can only be private (`SELF_ONLY`) and only on a private account. Switch to it (`"method": "direct"` in `config.json`) after the audit.

## Part 1: a TikTok developer app

1. Go to **developers.tiktok.com**, **Log in** with your TikTok account, and register as a developer if asked.
2. **Manage apps → Connect an app** (or **Create app**). Choose an individual developer if asked.
3. **Basic information:** an icon, name `autopost`, a category, a short description. For review TikTok also wants a website, a **Terms of Service** URL and a **Privacy Policy** URL; `docs/terms.md` and `docs/privacy.md` in this repository work if the repository is public.
4. **Add products:** **Login Kit** and **Content Posting API**.
5. **Scopes:** `user.info.basic` and `video.upload` (add `video.publish` only for direct posting).
6. **Login Kit → Redirect URI → Web:** the sign-in page that comes with this repository, `docs/connect.html`. Turn on GitHub Pages first (**Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder `/docs` → **Save**). On a free plan Pages needs a public repository, so you can serve the page from a public copy of this template and keep your working copy private. Its address is then `https://your-name.github.io/your-repo/connect.html`. TikTok sends you back there after you sign in, and the page shows the code with a Copy button and the next step. Any https address you control works too, such as the repository's own address; then you copy the code out of the address bar yourself.
7. Save.

To try it before review (and to film the review video), open **Sandbox** (top of the app page) → **Create sandbox**, give it the same products, scopes and redirect URI, and under **Target users → Add account** add your own TikTok account. A sandbox has its own client key and secret; use those while you test. To use it for real, submit the app for review.

## Part 2: save the app's keys

In your repository: **Settings → Secrets and variables → Actions**.

- **Variables** tab → `TIKTOK_CLIENT_KEY` = the **Client key** (not secret; it appears in the sign-in link).
- **Variables** tab → `TIKTOK_REDIRECT_URI` = the redirect URI from part 1, exactly as typed there.
- **Secrets** tab → `TIKTOK_CLIENT_SECRET` = the **Client secret** (copy it straight from TikTok's page).

## Part 3: sign in once

1. **Actions → Autopost connect → Run workflow** → app `tiktok-link`, leave the box empty (fill in **account** for any account but your first) → **Run workflow**.
2. Open the run → its summary shows a sign-in link. Open it, sign in to the TikTok account to post to, and **Authorize**.
3. TikTok sends you to your redirect address. On `connect.html`, tap **Copy code**; on any other address, copy everything after `code=` up to the next `&` in the address bar.
4. Straight away (the code lasts a few minutes): **Actions → Autopost connect → Run workflow** → app `tiktok`, paste the code (and the same **account** as in step 1, if not your first) → **Run workflow**.
5. The run should end with `TikTok connected; TIKTOK_REFRESH_TOKEN saved`.

The token lasts about a year and is renewed whenever the job uses it (that's what the admin token is for). If you revoke the app in TikTok, repeat part 3.

## Part 4: check

**Actions → Autopost → Run workflow** → action `check`. It should say `tiktok: OK, signed in`.

## TikTok's review (to use it beyond the sandbox)

TikTok reviews every app before it works for accounts outside its sandbox, and the review wants a screen recording of the app in use. In inbox mode the app only needs `user.info.basic` and `video.upload`, which keeps the review simple. Don't ask for `video.publish` unless you will post directly: asking for a permission the recording doesn't show is a common reason to be turned down.

Before you submit, check that the app's **website**, **Terms of Service** and **Privacy Policy** links open (with Pages on: `https://your-name.github.io/your-repo/`, `.../terms.html`, `.../privacy.html`).

**The recording** (one take, 1 to 3 minutes, on a phone or a computer, in the sandbox with your own account as a target user):

1. Run **Autopost connect** with app `tiktok-link` and open the run. Its summary has a second link, to the sign-in page with its own **Sign in with TikTok** button. Start recording here.
2. Open that link: the page says what the app does and which two permissions it asks for. Tap **Sign in with TikTok**.
3. TikTok's own screen: sign in, show the permissions it lists, tap **Authorize**.
4. Back on the page: **Signed in with TikTok** and the code. Tap **Copy code**, run **Autopost connect** with app `tiktok`, paste, and show the run ending with "TikTok connected".
5. Run **Autopost → Run workflow** with action `post-now` and mode `test`, and show the run sending the video ("in your TikTok inbox").
6. Open TikTok: show the inbox notification, open the draft, paste the caption from the run's summary, and tap **Post** yourself (*Only me* is fine for the recording).

In the review form, describe it in plain words, for example: "A personal tool that uploads my own finished short videos to my TikTok drafts on a schedule. I review each draft, add the caption and post it myself in the TikTok app. It uses user.info.basic to show which account is connected and video.upload to send the drafts." Reviews usually take a few days; if TikTok asks for changes, it says which part was missing.

## Settings in `autopost/config.json`

- `appName`: your TikTok app's name, shown on the sign-in page so it matches what TikTok shows (default `autopost`).
- `method`: `inbox` or `direct` (above).
- `privacy`: for direct posts only: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR` or `SELF_ONLY`. TikTok only allows what its creator-info check offers.
- `isAigc`: adds TikTok's "Creator labeled as AI-generated" tag (direct posts; in inbox mode you set it in the app).
- `disableComment`, `disableDuet`, `disableStitch`: direct posts only.

At most 5 inbox drafts may be waiting in any 24 hours, so post your drafts as they come in.

To cut the job off: TikTok → **Settings and privacy → Security & permissions → Apps and services** (or **Manage app permissions**) → `autopost` → **Remove access**.
