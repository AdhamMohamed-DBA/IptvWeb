# IPTV Web PWA (Firebase + Xtream)

Modern IPTV web app using **React + Vite + PWA + Firebase Realtime DB + Firebase Hosting + Cloud Functions**.

## ✅ Features implemented

- PWA installable app (manifest + SW auto update)
- Anonymous Firebase Auth per user
- User-specific data in Realtime Database:
  - Favorites
  - Recently Watched
  - Continue Watching (with resume progress)
  - Playlist credentials saved under user settings
- Secure Xtream proxy through Firebase Functions (`/api/*`)
- Main pages:
  - Home
  - Live TV
  - Movies
  - Series
  - Favorites
  - Series details (episodes)
  - Player
- Live EPG section in player
- Poster fallback image handling

---

## 1) Prerequisites

- Node.js 20+
- Firebase CLI
  - `npm i -g firebase-tools`

---

## 2) Install dependencies

From project root:

```bash
npm install
```

For functions:

```bash
npm install --prefix functions
```

---

## 3) Environment

Copy `.env.example` to `.env`:

```bash
copy .env.example .env
```

(`copy` is Windows cmd. In PowerShell use `Copy-Item .env.example .env`.)

---

## 4) Firebase Console setup

Project: `iptvweb-f0745`

1. Enable **Authentication → Anonymous**
2. Create **Realtime Database** in `europe-west1`
3. Apply `database.rules.json`
4. Enable **Hosting**
5. Enable **Functions** (Blaze plan may be required)

---

## 5) Run locally

Frontend:

```bash
npm run dev
```

Build check:

```bash
npm run build
```

---

## 6) Deploy

Deploy all:

```bash
npm run deploy
```

Or separate:

```bash
npm run deploy:functions
npm run deploy:hosting
```

---

## 7) API routes used by frontend

All proxied by Firebase Function `api`:

- `GET /api/categories?type=live|movie|series`
- `GET /api/streams?type=...&category_id=...`
- `GET /api/series/:seriesId`
- `GET /api/epg?stream_id=...&limit=...`

Auth: frontend sends Firebase ID token in `Authorization: Bearer ...`.
Function reads playlist credentials from `users/{uid}/settings/playlist`.

---

## 8) GitHub push (if needed)

```bash
git add .
git commit -m "Initial IPTV Web PWA with Firebase + Functions proxy"
git push origin main
```

---

## Notes

- UI is ready and extensible (dark modern layout)
- You can later add:
  - better EPG timeline UI
  - watchlist notifications
  - offline caching strategy improvements
