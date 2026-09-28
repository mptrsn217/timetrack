# Timetrack

Personal start/stop time tracker. Node + Postgres, single-page PWA.

## Deploy on Railway
1. Push this folder to a GitHub repo.
2. Railway → New Project → Deploy from GitHub repo.
3. In the project: + New → Database → PostgreSQL.
4. On the web service → Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference the DB service)
   - `APP_PIN` = any PIN you like (leave unset for no PIN)
5. Settings → Networking → Generate Domain.

Tables are created automatically on first start.

## Phone
- Open the URL, "Add to Home Screen" (Android Chrome / iOS Safari).
- Android: tap "Enable lock-screen timer" → the running activity stays as a notification with a Stop button.
- iOS: no persistent notification for web apps; use the home-screen app.

## Local
```
DATABASE_URL=postgres://... APP_PIN=1234 npm start
```
