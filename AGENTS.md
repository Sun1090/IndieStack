# IndieStack Agents

> The project's AI-assistant system — provides specialized role definitions and workflows for AI collaboration.
> Each agent focuses on one domain and follows project conventions and best practices.

## Reuse First

Prefer what's already installed over hand-rolled code: check `package.json` for a dependency that covers the need before writing your own, and grep `src/components/shared/` + `src/lib/actions/` for an existing component or action before creating a new one. Queries go through `src/lib/repositories/`; navigation uses `ROUTES.*`. Add a new dependency only when nothing installed or built-in fits, and state why in the PR.

## Quick Reference

| ID | Agent | Responsibility | File |
|----|-------|----------------|-----|
| 01 | Code Writer | Write high-quality code that follows project conventions | [agents/01-code-writer.md](./agents/01-code-writer.md) |
| 02 | Code Reviewer | Review code quality, consistency, and potential issues | [agents/02-code-reviewer.md](./agents/02-code-reviewer.md) |
| 03 | Project Auditor | Full architecture, config, and health audit | [agents/03-project-auditor.md](./agents/03-project-auditor.md) |
| 04 | Architect | Architecture design, tech decisions, evolution planning | [agents/04-architect.md](./agents/04-architect.md) |
| 05 | Test Engineer | Test strategy, case authoring, and maintenance | [agents/05-test-engineer.md](./agents/05-test-engineer.md) |
| 06 | Documentation Writer | Documentation authoring, maintenance, i18n | [agents/06-documentation-writer.md](./agents/06-documentation-writer.md) |
| 07 | DBA | Database design, migration management, data safety | [agents/07-dba.md](./agents/07-dba.md) |
| 08 | DevOps | Deployment, CI/CD, infrastructure management | [agents/08-devops.md](./agents/08-devops.md) |
| 09 | UI/UX | Interface design, component specs, interaction patterns | [agents/09-ui-ux.md](./agents/09-ui-ux.md) |
| 10 | Release Manager | Commit conventions, branching, release flow, deploy verification | [agents/10-release-manager.md](./agents/10-release-manager.md) |

## When to Use Which

| When you need to... | Use Agent |
|---------------------|----------|
| Add a feature, write code | [01 Code Writer](./agents/01-code-writer.md) |
| Review before a PR | [02 Code Reviewer](./agents/02-code-reviewer.md) |
| Full project health check | [03 Project Auditor](./agents/03-project-auditor.md) |
| Make architecture decisions or plans | [04 Architect](./agents/04-architect.md) |
| Write or maintain tests | [05 Test Engineer](./agents/05-test-engineer.md) |
| Write or update docs | [06 Documentation Writer](./agents/06-documentation-writer.md) |
| Design a database or migration | [07 DBA](./agents/07-dba.md) |
| Configure deployment or CI/CD | [08 DevOps](./agents/08-devops.md) |
| Design UI or components | [09 UI/UX](./agents/09-ui-ux.md) |
| Commit, release, or verify a deployment | [10 Release Manager](./agents/10-release-manager.md) |

## ⛔ Mandatory Pre-push Rules (all agents and humans)

> Lesson learned 2026-08-23: pushing without a local build caused a Vercel production build failure
> (`next-intl MISSING_MESSAGE` only surfaces during static generation; type-check/lint can't catch it).

**Every `git push` must pass, in order:**

```bash
pnpm lint        # ESLint (complexity/a11y rules)
pnpm type-check  # TypeScript
pnpm test        # full test suite
pnpm build       # production build ← critical: i18n missing keys / SSG errors surface only here
```

Or one-shot: `pnpm verify:build`. The pre-push hook auto-runs test + build.
Pushing without these is treated as an incident.

## Agent Collaboration Flow

```
requirement → pick the right agent → execute → cross-review → done
```

1. **Pick an agent** from the table above based on task type.
2. **Execute** following the specs, flows, and checklists in that agent's doc.
3. **Cross-review**: after a complex task, invoke a related agent to cross-review (e.g. Code Reviewer after Code Writer).
4. **Finish**: tests pass, docs updated, code committed.

## Maintenance

- When adding an agent, add a row here and create `agents/{id}-{name}.md`.
- When updating an agent, keep this index file's description in sync.
- Commit convention: Conventional Commits, enforced by commitlint (config in `commitlint.config.js`). No `Co-Authored-By` or AI sign-off; one commit = one logical topic.

---

*Last updated: 2026-08-26*

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Autonomous Execution and Remote Branch Lifecycle

- Work continuously: inspect roadmap/TODOs/progress and failing quality gates, choose the highest-priority executable task, implement, test, fix, commit atomically, update progress, and immediately continue. A completed task, PR, release, or milestone is not a stopping condition.
- Stop only when no executable work remains, a product decision or unavailable credential/account/production permission is required, every remaining task is upstream-blocked, or a hard tool/context limit prevents further work.
- The protected default branch is PR-only. Never push it directly, force-push, create merge commits, rewrite shared history, or change protection rules.
- Remote topic branches (`feat/*`, `fix/*`, `codex/*`, `release/*`, etc.) are temporary PR transport only—not backups or checkpoints. Publish only review/CI-ready work or updates to an active PR.
- Before publishing, fetch/prune and audit existing PRs/branches; reuse or finish relevant work instead of creating duplicates. Rebase safely on `origin/<base>` before publishing.
- After a PR is merged or closed, immediately delete its remote branch and prune. The normal remote steady state is only the protected branch plus the minimum branches attached to active PRs.
- Never discard unfinished local work: finish and validate it, merge through a PR, then clean up its local and remote branches.

## Product Boundaries (thesis → queue, not checklist)

Boundaries derive from the project thesis: a production-grade Next.js / Supabase starter template for indie developers. Queues derive from this boundary; parked ideas are not backlog items unless their entry conditions are met.

### In Scope (template thesis-internal queue)

- The v0.12.0 task pool (notification delivery semantics, release evidence, gate infrastructure, doc governance)

### Out of Scope (parking; every item carries entry conditions)

- Platformization / hosted-service offerings: entry = deliberate repositioning from starter template to platform
- Own MCP / agent-product surface: entry = validated demand on top of the template thesis

### Environment Blocked (external permissions, NOT ideas)

- B-domain release evidence: entry = Vercel deploy/build quota + cloud Supabase credentials + disposable isolated account (roadmap risk note already states v0.12.0 exit criteria cannot be claimed without them)

### Boundary Review Signals (check before moving any boundary)

- Whether starter-template users keep asking for hosted/runtime offerings
- Whether external permissions for the B-domain evidence have materialized
