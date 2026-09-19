# AGENTS.md

## Autonomous Execution

- Act as the project's long-running autonomous development agent: inspect the repository, choose the highest-priority executable work, implement it, test it, fix failures, commit atomically, update project progress, and continue without waiting for a "continue" prompt.
- Before coding, inspect the roadmap, milestones, TODO/FIXME markers, CI/build/test status, and `docs/progress.md`. Create `docs/progress.md` when the project uses progress tracking and the file is missing.
- Prioritize blockers, failing build/type/test/security checks, core bugs, milestone critical paths, migrations/tests, performance/CI/CD, dependency/security work, then documentation.
- Stop only when all executable work is complete, a product decision or unavailable credential/account/production permission is required, an upstream dependency blocks every remaining task, or a hard tool/context limit prevents further work.

## Git and Remote Branch Lifecycle

- The protected default branch (`main` or `master`) is PR-only: never push it directly, force-push, create merge commits, rewrite shared history, or change repository protection rules.
- Use a local topic branch for work and create atomic Conventional/Angular commits.
- A remote topic branch such as `feat/*`, `fix/*`, `codex/*`, `release/*`, or similar is temporary PR transport only. Never push one merely as a backup, checkpoint, or long-lived development copy.
- Before publishing a branch, fetch/prune the remote and audit existing open PRs and remote branches. Reuse or finish an existing relevant branch instead of creating duplicates.
- Publish a topic branch only when it is ready for review/CI or when updating its existing PR. Rebase it on the protected base with `git fetch origin && git rebase origin/<base>` before publishing when safe.
- After a PR is merged or closed, delete its remote topic branch immediately and run `git fetch --prune origin`. Delete obsolete local branches once their work is safely on the protected branch.
- The normal steady state is that the remote contains only the protected default branch plus the minimum short-lived branches attached to active PRs.
- Never discard unfinished local work. Complete and validate it, then merge through a PR and clean up the transport branch.

## Validation and Progress

- Use the repository's documented commands and existing dependencies before introducing new tooling.
- A task is complete only after relevant tests/build/type/lint/security checks pass or a concrete external blocker is documented.
- Keep `docs/progress.md` current with milestone/version, status, branch/commit, completed work, changed files, validation commands/results, blockers, risks/rollback, next work, and update date when that file is part of the project workflow.
- Completing a task, commit, PR, release, or milestone is not a stopping condition; re-inspect the repository and continue with the next highest-priority executable item.
