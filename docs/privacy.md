# Privacy policy

_For the copy of Autopost run from this repository. Last updated 2026-11-19._

Autopost is a small tool that the owner of this repository runs for their own accounts. It posts videos they made to their own YouTube, Instagram and TikTok accounts on a schedule. It has no users other than the owner and offers no service to the public.

**What it accesses.** Only the accounts the owner connects, and only what posting needs: permission to upload videos, read the account's name to confirm it is the right one, and check whether an upload finished. It does not read messages, comments, followers, contacts, analytics or any other person's data.

**What it stores.** Sign-in tokens are kept in this repository's encrypted GitHub Actions secrets, readable only by the job that posts. A log of what was posted (video name, time, and the link each app returned) is kept on this repository's `autopost-log` branch. Nothing else is stored, and nothing is kept anywhere outside GitHub.

**What it shares.** Nothing. No data is sold, shared with third parties, or used for advertising. Videos and captions go only to the app they are posted to.

**Removing access.** The owner can cut Autopost off at any time from each app's settings (Google account: Security, third-party connections; Facebook: Business integrations; TikTok: Manage app permissions) and by deleting the repository's secrets.

**Contact.** Open an issue on this repository, or reach the owner through their GitHub profile.
