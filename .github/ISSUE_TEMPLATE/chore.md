---
name: Chore
about: Maintenance task, dependency update, or housekeeping work.
title: "[Chore]: "
labels: chore
---

## Summary
Describe the maintenance task or update needed.

## Type
- [ ] Dependency update
- [ ] Security patch
- [ ] Code cleanup / refactoring
- [ ] CI/CD improvement
- [ ] Documentation maintenance
- [ ] Performance optimization
- [ ] Technical debt
- [ ] Other maintenance

## Affected Area
<!-- Check all that apply -->
- [ ] CLI (`src/cli/`, `src/commands/`)
- [ ] Gateway (`src/gateway/`, `src/daemon/`)
- [ ] Channel code (`src/telegram/`, `src/discord/`, etc.)
- [ ] Extensions (`extensions/*`)
- [ ] Apps (`apps/macos/`, `apps/ios/`, `apps/android/`)
- [ ] Scripts / CI (`.github/`, `scripts/`)
- [ ] Documentation (`docs/`)
- [ ] Build / packaging

## Details
<!--
Provide specifics about the work:
- Dependency updates: package name, current version → target version
- Security patches: CVE ID or advisory link if applicable
- Cleanup: files or areas affected
- Refactoring: keep files under ~700 LOC, no unrelated changes
-->

## Motivation
Why is this maintenance work needed now?

## Breaking changes
Will this change affect users or require migration steps?
- [ ] No breaking changes
- [ ] Breaking changes (describe below):

## Testing requirements
<!-- How should this be verified? -->
- [ ] Run `pnpm lint && pnpm build && pnpm test`
- [ ] Manual verification needed (describe)
- [ ] Live testing required (`GIMLI_LIVE_TEST=1 pnpm test:live`)

## Additional context
Links to changelogs, security advisories, or related issues.

<!--
Note: Per CLAUDE.md, any dependency with `pnpm.patchedDependencies`
must use an exact version (no ^/~). Patching requires explicit approval.
-->
