# YouTube setup

About 15 minutes, all in a web browser (a computer is easier than a phone for part 1). You end with three secrets: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`. Copy each value straight from Google's page into GitHub's secret box (README, "Where your keys and logins go"); never paste it anywhere else.

Google renames these menus now and then; if a name below doesn't match, look for the closest one.

## Part 1: a Google Cloud project with the YouTube API

1. Go to **console.cloud.google.com** and sign in with the Google account that owns the YouTube channel.
2. Top bar: the project picker → **New project**. Name it `autopost`, **Create**, and make sure it's selected.
3. Search bar: **YouTube Data API v3** → **Enable**.
4. Left menu: **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) → **Get started**.
   - App name `autopost`, your email as the support email, **Audience: External**, your email as the contact. **Create**.
   - **Branding:** publishing needs an app home page and a privacy policy link. If this repository is public, use its address and `docs/privacy.md` here (for example `https://github.com/you/auto-poster` and `https://github.com/you/auto-poster/blob/main/docs/privacy.md`); otherwise any public page of yours with the same words. Don't upload a logo: a logo makes Google want to review the app.
5. **Data access** → **Add or remove scopes** → find **`.../auth/youtube.upload`** (Manage your YouTube videos... upload) → tick it → **Update** → **Save**.
6. **Audience** → **Publish app** → **Confirm**. This matters: while an app is in "Testing", Google cuts its sign-in off after 7 days. Published but not verified is fine for your own channel; Google just shows a warning when you sign in, below.
7. **Clients** → **Create client**:
   - Application type: **Web application**, name `autopost`.
   - **Authorized redirect URIs → Add URI:** `https://developers.google.com/oauthplayground`
   - **Create.** Leave the window with the **Client ID** and **Client secret** open.
8. In another tab, in your GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**:
   - `YOUTUBE_CLIENT_ID` = the Client ID
   - `YOUTUBE_CLIENT_SECRET` = the Client secret

## Part 2: sign in once to get the refresh token

Google's OAuth Playground does the sign-in in your browser, so nothing needs installing.

1. Open **developers.google.com/oauthplayground**.
2. Click the **gear** (top right) → tick **Use your own OAuth credentials** → paste the Client ID and Client secret → close the gear box.
3. Left side, **Step 1**: in the box **Input your own scopes**, type `https://www.googleapis.com/auth/youtube.upload` → **Authorize APIs**.
4. Sign in with the account that owns the channel. If you manage several channels, pick the right one.
5. Google warns that the app isn't verified: **Advanced** → **Go to autopost (unsafe)**. (It's your own app.) **Continue** / **Allow**.
6. Back in the Playground, **Step 2** → **Exchange authorization code for tokens**.
7. Copy the **Refresh token** and save it as the secret `YOUTUBE_REFRESH_TOKEN`.
8. Close the Playground tab. (Don't press any "revoke" button; that would cancel the token.)

## Part 3: check

Repository → **Actions** → **Autopost** → **Run workflow** → action `check` → **Run workflow**. Open the run: it should say `youtube: OK, channel "..."` with your channel's name.

## Settings in `autopost/config.json`

- `privacy`: `public`, `unlisted` or `private` for live posts (test mode always uses private).
- `categoryId`: `20` is Gaming, `27` Education, `28` Science & Technology, `24` Entertainment.
- `madeForKids`: must be honest; `false` for content not made for children.
- `containsSyntheticMedia`: YouTube's label for realistic altered or AI-made footage that could be mistaken for real.
- `setThumbnail`: uploads the cover image. Needs a phone-verified channel, and Shorts mostly show a frame anyway.

To cut the job off: myaccount.google.com → **Security** → **Your connections to third-party apps & services** → `autopost` → remove access.
