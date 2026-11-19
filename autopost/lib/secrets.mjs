// Saving a secret back to the repository, for tokens that change when they are used (TikTok's refresh
// token) and for the one-time connect step. It uses the GitHub CLI that GitHub's runners come with, and
// needs AUTOPOST_ADMIN_TOKEN: a fine-grained token for this one repository with "Secrets: read and write".
// The value goes in on standard input, so it never appears in a command line or a log.
import { spawnSync } from "node:child_process";

export function canSaveSecrets(env) {
  return Boolean(env.AUTOPOST_ADMIN_TOKEN && env.GITHUB_REPOSITORY);
}

export function saveSecret(env, name, value) {
  if (!canSaveSecrets(env)) throw new Error(`cannot save ${name}: add the AUTOPOST_ADMIN_TOKEN secret (see README, "The admin token")`);
  if (env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`);
  const r = spawnSync("gh", ["secret", "set", name, "--repo", env.GITHUB_REPOSITORY], {
    input: value,
    env: { ...process.env, GH_TOKEN: env.AUTOPOST_ADMIN_TOKEN },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`saving ${name} failed: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
}
