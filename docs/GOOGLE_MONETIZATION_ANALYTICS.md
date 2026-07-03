# Google monetization and analytics setup

The codebase supports real AdSense units, GA4 tracking, and a private Analytics dashboard. Credentials are deployment variables and must never be committed.

## AdSense

1. Add `callout-social.onrender.com` to the approved AdSense account and complete Google's review.
2. Create responsive ad units for header, sidebar, right rail, in-feed, and footer placements.
3. Add the publisher ID and numeric slot IDs to Render:

```text
ADSENSE_CLIENT_ID=ca-pub-...
ADSENSE_SLOT_HEADER=...
ADSENSE_SLOT_SIDEBAR=...
ADSENSE_SLOT_RIGHT_RAIL=...
ADSENSE_SLOT_IN_FEED=...
ADSENSE_SLOT_FOOTER=...
```

When these values are absent, Callout keeps the existing non-disruptive placeholders. Filled units replace the placeholder copy; unfilled units fall back to the placeholder layout.

## GA4 tracking

1. Create a GA4 property and Web data stream for the production domain.
2. Add its Measurement ID to Render:

```text
GA_MEASUREMENT_ID=G-...
```

After the visitor's consent choice permits analytics storage, Callout sends SPA page views and product events for login, signup, posts, guild creation, Takes, and Based/Cringe ranking.

## Private traffic dashboard

1. Enable Google Analytics Data API in the Google Cloud project.
2. Create a service account with no project-wide write permissions.
3. In GA4 Property Access Management, add the service-account email as a Viewer.
4. Add these Render variables:

```text
GA_PROPERTY_ID=123456789
GA_CLIENT_EMAIL=analytics-reader@project.iam.gserviceaccount.com
GA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ADMIN_EMAILS=your-login-email@example.com
```

Only signed-in accounts listed in `ADMIN_EMAILS` receive the Analytics navigation item or can call the reporting endpoint. Report results are cached for five minutes.

## Consent requirement

Callout defaults Google Consent Mode storage to denied. Before enabling ads and analytics for production traffic, configure Google's certified CMP in AdSense **Privacy & messaging**, including its Consent Mode integration. This is required for AdSense traffic in the EEA, UK, and Switzerland and is especially relevant to the Malta launch.
