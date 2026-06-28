# Key Screen Wireframes

## Guild overview

```text
┌ Banner / theme ───────────────────────────────────────────────┐
│ [Icon] Guild name · privacy · members       [Join / Manage] │
└──────────────────────────────────────────────────────────────┘
[Overview] [Feed] [Chat] [Members] [Manage]
┌ Pinned announcement / rules ┐  ┌ Members online ┐
│ Owner message and rules      │  │ avatar + role  │
└──────────────────────────────┘  └────────────────┘
┌ Member feed or members-only lock ────────────────────────────┐
└──────────────────────────────────────────────────────────────┘
```

## Roles and permissions

```text
Roles                 Permissions
[Owner]               [✓] Manage guild  [✓] Manage members
[Moderator]           [✓] Moderate      [ ] Manage guild
[Contributor]         [✓] Post          [✓] Chat
[Chatter]             [ ] Post          [✓] Chat
[Viewer]              [ ] Post          [ ] Chat
                      [Save role]  Every save creates audit log
```

## Rich composer

```text
Audience [Public ▾]       [Save draft]
[B] [I] [Spoiler] [@] [Topic] [Poll] [Schedule]
┌ Write a post… ───────────────────────────────────────────────┐
└──────────────────────────────────────────────────────────────┘
Attachment carousel (0/5)   Poll options   Content warning
Reaction set [Classic ▾]    [Publish / Schedule]
```

## Notification center

```text
[All] [Likes] [Takes] [Mentions] [Friends] [Guilds] [DMs]
● [avatar] Name added a Take on “preview…”       2m  [Open]
  [avatar] Guild approved your request           1h  [View]
[Mute category] [Snooze source] [Delivery settings]
```

## Profile

```text
┌ Custom banner ───────────────────────────────────────────────┐
│ [Avatar+frame] Name · pronouns · status   [Follow] [Message]│
└──────────────────────────────────────────────────────────────┘
Stats: Vibe · posts · Takes · guilds · streak
[Posts] [About] [Guilds] [Achievements] [Media]
Featured posts / pinned guilds / badges / social links
```

Mobile collapses secondary columns into tabs and bottom sheets; primary actions remain reachable without horizontal page scrolling.
