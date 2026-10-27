import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { requireGit } from "../../agents/worktrees/git.js";
import type { LocalWorkspaceOwner } from "./local-workspace-types.js";

/** Seed the canonical checkout with source, ignored host bytes, and host Git configuration. */
export async function createLocalWorkspaceProjectionFixture(params: {
  root: string;
  assertCurrent: LocalWorkspaceOwner["assertCurrent"];
}) {
  const repo = path.join(params.root, "source");
  const canonical = path.join(params.root, "canonical");
  await fs.mkdir(repo);
  await requireGit(repo, ["init", "--quiet", "-b", "main"]);
  await requireGit(repo, ["config", "user.name", "Test"]);
  await requireGit(repo, ["config", "user.email", "test@example.invalid"]);
  await fs.writeFile(path.join(repo, "source.txt"), "original\n");
  await fs.writeFile(path.join(repo, ".gitignore"), ".env.local\n");
  await requireGit(repo, ["add", "."]);
  await requireGit(repo, ["commit", "--quiet", "-m", "base"]);
  await requireGit(repo, ["worktree", "add", "--quiet", "-b", "openclaw/guest", canonical]);
  await fs.writeFile(path.join(canonical, ".env.local"), "host-only-secret");
  await requireGit(repo, ["config", "credential.helper", "!echo host-credential"]);
  const sessionKey = `agent:main:dashboard:guest-${randomUUID()}`;
  const owner: LocalWorkspaceOwner = {
    agentId: "main",
    sessionKey,
    sessionId: randomUUID(),
    lifecycleRevision: null,
    assertCurrent: params.assertCurrent,
    worktree: {
      id: randomUUID(),
      name: "guest",
      repoFingerprint: "test",
      repoRoot: repo,
      path: canonical,
      branch: "openclaw/guest",
      baseRef: "main",
      ownerKind: "session",
      ownerId: sessionKey,
      createdAt: 0,
      lastActiveAt: 0,
    },
  };
  return { repo, canonical, owner };
}
