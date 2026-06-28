# Callout Creator-First Product Roadmap

## Priorities

### P0 — Trust and permissions

1. Guild membership, privacy, roles, and posting permissions.
2. Auditable guild administration.
3. Account-specific notifications with read state and mute controls.
4. Draft-safe composer validation and scheduled publishing.

### P1 — Creation and community

1. Rich composer: formatting, five attachments, polls, topics, warnings, audience, drafts, and schedules.
2. Guild announcements, member directory, role editor, and join requests.
3. Notification delivery preferences and contextual navigation.
4. Configurable sidebar modules and expanded profile presentation.

### P2 — Growth

1. Push and email delivery providers.
2. Link preview unfurling through a safe server-side metadata service.
3. Full presence/pub-sub infrastructure and mobile push.
4. Creator analytics, discovery experiments, and official launch content.

## Acceptance criteria

- A new guild permits only its owner to post. Granting `post` permission enables posting without granting management access.
- Private guilds expose their public profile but require approval or a valid invite before member content is available.
- Owners can assign roles; every role, permission, privacy, and member change creates an audit entry with actor and timestamp.
- Notification rows show the actor avatar, type, preview, timestamp, and read state. Muted/snoozed sources do not appear until the rule expires.
- The composer accepts up to five attachments, saves/restores drafts, validates polls, schedules future posts, and supports audience and content-warning controls.
- Sidebar widgets can be reordered and retain their order on the device.
- Profile editing has a live preview and public profiles expose activity, badges, featured posts, pinned guilds, media, and About sections.
- Keyboard navigation, visible focus, labels, contrast, and reduced-motion behavior meet WCAG 2.2 AA expectations.

## Success metrics

- Guild creation-to-first-member conversion.
- Join-request approval time and permission-denied error rate.
- Draft-to-published conversion and scheduled-post success rate.
- Notification open/read rate by category and mute rate.
- Messages, Takes, posts, and guild chat messages per weekly active user.
- Client error rate, API 4xx/5xx rate, and p95 response time.
