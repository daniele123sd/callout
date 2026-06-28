# Staged Rollout and Beta Plan

## Stage 0 — Internal

- Run migrations and integrity checks in dry-run mode.
- Enable features only for configured beta accounts.
- Verify permission denial, audit creation, scheduled publishing, notification grouping, and rollback.

## Stage 1 — Guild and notification beta

- Invite a small group of guild creators.
- Enable role management, join requests, notification controls, and creator audit logs.
- Review support reports daily; monitor 403/409/500 rates and client errors.
- Exit criteria: no critical privacy issue, no privilege escalation, and less than 1% failed guild mutations.

## Stage 2 — Composer beta

- Enable drafts, five attachments, polls, warnings, audience, and scheduling for beta creators.
- Confirm scheduled-post worker accuracy and retry behavior.
- Exit criteria: 99% scheduled publication within two minutes and no lost drafts in the beta window.

## Stage 3 — Gradual release

- Roll out 10% → 25% → 50% → 100%, holding each stage for at least 24 hours.
- Roll back by feature flag; schema additions remain backward compatible.

## Migration and rollback

- Backfill owner memberships and five default roles for existing guilds.
- Preserve the legacy `members` array during the compatibility window.
- Migration is idempotent and supports `--dry-run`.
- Rollback disables UI/API flags without deleting new role, audit, draft, or preference data.

## Required beta checks

- Owner-only posting default and delegated posting.
- Private profile visibility versus member-only content.
- Invite rotation and expired/invalid invite handling.
- Notification avatar, grouping, mute/snooze, and delivery toggles.
- Keyboard-only composer, member manager, roles editor, and notification center.
