# Callout production deployment

This project is prepared for a Render Web Service backed by MongoDB Atlas.

## 1. Create the MongoDB database

1. Create a MongoDB Atlas account and a free cluster.
2. Create a database user with a strong generated password.
3. In Network Access, allow connections from the Render service. Render free services do not provide a fixed outbound IP, so the initial setup normally uses `0.0.0.0/0`; keep the database password strong and unique.
4. Choose **Connect → Drivers → Node.js** and copy the `mongodb+srv://...` connection string.
5. Replace the username, password, and database name. Use `callout` as the database name.

The completed URI becomes the Render `DB_URI` secret. Never commit it to Git.

## 2. Create the Google OAuth application

1. Create a project in Google Cloud Console.
2. Configure the OAuth consent screen.
3. Create an **OAuth client ID** for a Web application.
4. Add the production callback URL:

   `https://YOUR-RENDER-SERVICE.onrender.com/api/auth/google/callback`

5. Save the client ID and secret for Render.

Use these Render environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`

## 3. Put the existing folder on GitHub

Create a private GitHub repository and push this existing project folder to its `main` branch. `.env` and `node_modules` are already excluded by `.gitignore`.

## 4. Create the Render service

1. In Render, choose **New → Blueprint**.
2. Connect the GitHub repository containing this `render.yaml`.
3. Enter the requested secret values:
   - `DB_URI`: MongoDB Atlas connection string
   - `APP_ORIGIN`: `https://YOUR-RENDER-SERVICE.onrender.com`
   - Google OAuth values from step 2
4. Render automatically generates separate JWT access and refresh secrets.
5. Deploy the Blueprint.

Render uses:

- Build: `corepack enable && pnpm install --frozen-lockfile`
- Start: `pnpm start`
- Health check: `/api/health`
- Region: Frankfurt

## 5. Verify production

After the deployment reports healthy:

1. Open the `onrender.com` URL.
2. Create an email account and sign out/in.
3. Test Google sign-in.
4. Create, edit, share, and delete a take.
5. Save profile customization and reload.
6. Open `/privacy` and `/terms`.
7. Confirm Light, Dark, and System themes.

## 6. Optional domain and ads

Add a custom domain in Render and update `APP_ORIGIN` plus the Google callback URL. Follow [Google monetization and analytics setup](docs/GOOGLE_MONETIZATION_ANALYTICS.md) for AdSense units, GA4 reporting credentials, administrator access, and the required consent configuration.
