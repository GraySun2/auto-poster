# Instagram setup

About 15 minutes in a web browser. You need an Instagram **professional** account (Creator or Business) linked to a **Facebook Page**. You end with the secrets `META_APP_ID` and `META_APP_SECRET`, which you save, and `INSTAGRAM_USER_ID` and `INSTAGRAM_ACCESS_TOKEN`, which the connect step saves for you. Save the [admin token](../README.md#the-admin-token) first.

Meta renames these menus often; if a name below doesn't match, look for the closest one.

## Part 1: check the account

In the Instagram app: **Profile → ☰ → Settings → Account type and tools**. It should say you have a professional account. Then **Accounts Centre** (or **Edit profile → Page**) should show the Facebook Page it is linked to.

## Part 2: a Meta developer app

1. Go to **developers.facebook.com**, sign in with the Facebook account that manages the Page, and register as a developer if asked.
2. **My Apps → Create app**.
   - Name `autopost`, your email.
   - **Use case:** the one for managing **Instagram** content with **Facebook Login** (or "Other" → app type **Business**).
   - Connect a business portfolio if asked (or skip if it lets you). **Create app.**
3. If the app asks you to add products, add **Instagram** (the API setup "with Facebook login").
4. Leave the app in **Development** mode. In development mode it works for the people who have a role on the app, which includes you, and that is all it needs to post to your own account.
5. **App settings → Basic**: copy **App ID** into the secret `META_APP_ID`, and **App secret** (Show) into the secret `META_APP_SECRET`.

## Part 3: sign in once

1. Open **developers.facebook.com/tools/explorer** (the Graph API Explorer).
2. Right side: **Meta App** = `autopost`; **User or Page** = **User Token**.
3. **Permissions → Add a permission**, add all of these:
   `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management`
4. **Generate Access Token**. Facebook asks which Pages and Instagram accounts to share: pick the Page and the Instagram account you post to, and allow everything listed.
5. Copy the token in the **Access Token** box. It only lasts about an hour, so do the next step right away.
6. In your repository: **Actions → Autopost connect → Run workflow**:
   - app: `instagram`
   - pasted: the token
   - page_name: leave empty, unless you have more than one Page with an Instagram account (then the Page's exact name)
   - **Run workflow.**
7. Open the run. It should end with `Instagram connected: @yourname through the Page "..."`. It has saved `INSTAGRAM_USER_ID` and `INSTAGRAM_ACCESS_TOKEN`.

The saved token is a Page token made from a long-lived sign-in, which Meta does not time out. It stops working if you change your Facebook password, remove the app, or lose admin of the Page; then repeat part 3.

## Part 4: check

**Actions → Autopost → Run workflow** → action `check`. It should say `instagram: OK, account @yourname`.

Instagram has no private posts, so test mode skips it. The first Instagram post happens in live mode.

## Settings in `autopost/config.json`

- `shareToFeed`: also show the reel on your main grid (`true`) or only in the Reels tab.
- `isAiGenerated`: asks Instagram to show its AI label.
- `apiVersion`: the Graph API version. Meta retires versions after about two years; move it forward when Meta's changelog says so.

To cut the job off: Facebook → **Settings & privacy → Settings → Business integrations** → `autopost` → **Remove**.
