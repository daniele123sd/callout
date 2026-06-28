# Creator Features API Specification

All authenticated routes use Callout's HTTP-only access cookie. IDs accept MongoDB ObjectIds in production and UUIDs in the local fallback store.

## Guilds

- `POST /api/guilds` — create guild and owner membership/default roles.
- `GET /api/guilds/:id` — public profile plus viewer capabilities.
- `PATCH /api/guilds/:id` — update guild when `manageGuild` is granted.
- `POST /api/guilds/:id/membership` — public join/leave or private join request.
- `POST /api/guilds/:id/invites` — rotate/create invite code.
- `POST /api/guilds/join/:code` — join by invite.
- `GET /api/guilds/:id/members` — member directory and pending requests.
- `PATCH /api/guilds/:id/members/:userId` — approve, reject, remove, or assign role.
- `GET|POST /api/guilds/:id/roles` — list/create roles.
- `PATCH /api/guilds/:id/roles/:roleId` — update role and permissions.
- `GET /api/guilds/:id/audit` — owner/moderator audit history.
- `GET|POST /api/guilds/:id/posts` — member feed, gated by `view`/`post` permissions.
- `GET|POST /api/guilds/:id/messages` — group chat, gated by `chat` permission.

## Notifications

- `GET /api/notifications?type=&grouped=` — account-specific filtered notifications.
- `POST /api/notifications/read` — mark all or selected IDs read.
- `GET|PUT /api/notification-preferences` — delivery channels and category settings.
- `GET|POST|DELETE /api/notification-mutes` — user/guild/category mute and snooze rules.

## Composer

- `POST /api/posts` — publish, schedule, or save a draft.
- `GET /api/drafts` — current user's drafts.
- `PATCH /api/posts/:id` — update owned draft/post.
- `DELETE /api/posts/:id` — delete owned draft/post.
- Post fields: `content`, `contentType`, `media[]`, `poll`, `scheduledPublishedAt`, `visibility`, `guild`, `topics[]`, `mentions[]`, `contentWarning`, `reactionSet`, `draft`, and `embedUrl`.

## Profiles and widgets

- `GET /api/users/:id` — public profile, stats, badges, featured posts, and pinned guilds.
- `PATCH /api/profile` — profile customization and delivery preferences.
- Sidebar ordering is device-local initially; account sync is a later compatible endpoint.

## Error contract

```json
{ "error": "Human-readable summary", "details": ["Optional field error"] }
```

Permission failures return `403`, private resources not visible to the viewer return `403`, missing records return `404`, and validation failures return `400`.
