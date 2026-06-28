const truthy = new Set(['1', 'true', 'yes', 'on']);

export const featureFlags = Object.freeze({
  creatorGuilds: process.env.FEATURE_CREATOR_GUILDS == null || truthy.has(String(process.env.FEATURE_CREATOR_GUILDS).toLowerCase()),
  richComposer: process.env.FEATURE_RICH_COMPOSER == null || truthy.has(String(process.env.FEATURE_RICH_COMPOSER).toLowerCase()),
  notificationControls: process.env.FEATURE_NOTIFICATION_CONTROLS == null || truthy.has(String(process.env.FEATURE_NOTIFICATION_CONTROLS).toLowerCase()),
  profileStudio: process.env.FEATURE_PROFILE_STUDIO == null || truthy.has(String(process.env.FEATURE_PROFILE_STUDIO).toLowerCase())
});
