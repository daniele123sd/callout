# Callout

Callout is an Express-backed social product prototype where people publish takes, vote **Based** or **Hot Take**, build Voice XP, customize profiles, join guilds, and participate in nested discussions.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install` (or `pnpm install`).
3. Copy `.env.example` to `.env` and replace the development secrets.
4. Run `npm start`.
5. Open `http://127.0.0.1:4173`.

For Cursor or VS Code preview, start the server first and open `http://localhost:4173`. Do not preview `index.html` directly as a file because authentication, DOMPurify, CSP, and API routes are served by Express.

When `DB_URI` is missing or MongoDB is unavailable, the server uses an in-memory development store so email signup, login, profile writes, and post APIs still work locally. Data in that fallback store resets when the server restarts.

## Google OAuth setup

Create an OAuth 2.0 web application in Google Cloud Console and add this authorized redirect URI for local development:

`http://127.0.0.1:4173/api/auth/google/callback`

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `.env`. Production must use its HTTPS origin and matching callback URL.

## Security architecture

- Joi validation and sanitization on account, profile, post, comment, message, and report inputs
- DOMPurify sanitization in the browser
- bcrypt password hashing with 12 salt rounds
- 15-minute JWT access tokens and rotating 7-day refresh tokens in HTTP-only, SameSite cookies
- Five authentication attempts per IP per minute
- Helmet CSP, referrer, and baseline security headers
- Password reset tokens are hashed before storage
- MongoDB user, post, and report schemas

## Product areas

- Home, Trending, Guilds, Leaderboards, Notifications, Messages, Saved, Profile, Settings, and Auth
- Animated Based/Hot Take response meter
- Dedicated take details with nested Reddit-style comments
- Discord-style profile customization, Voice XP, badges, banner, accent color, status, pronouns, and social links
- Conditional author/non-author post menus with edit, delete, share, and report flows
- Post menu text-to-speech export with three Callout voices, MP3 preview/download, and cached ElevenLabs generation
- Light, Dark, and System themes plus notification, privacy, and display preferences
- Privacy Policy and Terms of Service routes

## ElevenLabs text-to-speech setup

The TTS button is admin-only. Regular users do not see it and cannot use the TTS API. Callout uses one owner-managed ElevenLabs API key and three preset voices for admin MP3 exports.

Recommended setup:

1. Sign in as the Callout admin account.
2. Open any post's three-dot menu.
3. Choose **Text to Speech**.
4. Paste the ElevenLabs API key and the three labeled voice IDs into the admin-only setup form.
5. Press **Save voice setup**.

The API key is stored server-side and is never shown back in the UI. Normal users do not see voice generation controls.

Render environment variables are still supported as an optional fallback:

```text
ELEVENLABS_API_KEY=your-elevenlabs-api-key
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_VOICE_SPARK=voice-id-for-energetic-shortform
ELEVENLABS_VOICE_DEBATE=voice-id-for-confident-opinion
ELEVENLABS_VOICE_CALM=voice-id-for-clean-narration
```

Where to get them:

1. Open ElevenLabs.
2. Create or choose three voices.
3. Copy each voice ID into the matching field in Callout.
4. Copy your API key into the Callout setup form.

If setup is missing, only admins see the connection form. Generated audio is cached per post and voice so repeat downloads do not spend more ElevenLabs credits.

## Advertising integration

AdSense-ready units use `<ins class="adsbygoogle">` and placeholder client/slot values:

- `right-rail` — responsive right-rail rectangle
- `in-feed` — inserted after every third feed post
- `footer` — responsive horizontal footer unit

Replace `ca-pub-XXXXXXXXXXXXXXXX` and each placeholder slot value in `index.html` and `app.js` before production deployment.

The AdSense network script is intentionally not requested while the placeholder client ID is present. This prevents development browsers and embedded editor previews from waiting on an invalid advertising request.
