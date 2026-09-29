# Timetrack

Start/stop time tracker. Node + Postgres, single-page PWA. Anyone can sign in with Google; each account sees only its own data.

## 1. Google sign-in (Google Cloud Console)
1. https://console.cloud.google.com → create a project (e.g. "Timetrack").
2. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name "Timetrack", your support email.
   - Scopes: none extra needed (sign-in only uses email/profile).
   - **Audience → Publish app** so anyone can sign in (in "Testing" only listed test users can).
     No Google verification is needed for basic sign-in.
3. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `https://<your-app>.up.railway.app` (and `http://localhost:3000` for local testing).
   - No redirect URI needed.
4. Copy the **Client ID** (`....apps.googleusercontent.com`).

## 2. Deploy on Railway
1. New Project → Deploy from GitHub repo → this repo.
2. + New → Database → PostgreSQL.
3. Web service → Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `GOOGLE_CLIENT_ID` = the Client ID from step 1
   - `SESSION_SECRET` = a long random string (e.g. `openssl rand -hex 32`); keeps people signed in across deploys
   - `LEGACY_OWNER_EMAIL` = your Gmail (optional; only if you used the old PIN version: your existing data is moved into this account on first sign-in)
4. Settings → Networking → Generate Domain, then add that domain to the Google client's JavaScript origins.

Tables are created/migrated automatically on start. If the database refuses SSL, set `PGSSL=disable`.

## Phone
- Open the URL, sign in, "Add to Home Screen" (Android Chrome / iOS Safari).
- Android: tap "Enable lock-screen timer" → the running activity stays as a notification with a Stop button.
- iOS: no persistent notification for web apps; use the home-screen app.

## Notifications (Web Push)
- Profile picture → *Notifications* → *Turn on*. Works in Chrome/Edge/Firefox on Android and desktop, and on
  iPhone/iPad only in the Home Screen app (iOS 16.4+).
- Sends: timer started/stopped, a reminder for timers left running (4h+ or 3× the usual length), and goal reached /
  5 minutes left / over limit. Each can be switched off.
- No setup needed: the server generates its VAPID keys on first start and stores them in the database
  (table `app_settings`). To manage them yourself set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
  (`mailto:you@example.com`). Changing the keys disconnects every device until it turns notifications on again.

## Local
```
DATABASE_URL=postgres://... GOOGLE_CLIENT_ID=... npm start
```

## Backups
- **In the app** (profile picture → *Download backup*): a JSON file with all your activities, goals, entries and notes.
  *Restore from backup* merges a file back in: activities are matched by name and entries you already have are skipped, so restoring twice is safe.
  It also works for moving data between Google accounts.
- **Whole database (Railway)**: open the Postgres service → *Backups* tab → turn on scheduled backups (daily is a good default).
  Railway keeps them on the volume and can restore the database to any of them.
