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

> ⚠️ Important: Do **not** commit real Firebase keys/tokens in repository files.
> Keep real values in local `.env` only (already ignored by `.gitignore`) or CI/CD secrets.

---

## 4) Hosting choice (important)

This app depends on Firebase Cloud Functions routes under `/api/*`.

- ✅ **Recommended:** Firebase Hosting (works with `firebase.json` rewrites)
- ❌ **Not recommended for production:** GitHub Pages (static only, no Firebase Functions rewrites)

If you deploy static files only (e.g. GitHub Pages root), API calls to `/api/*` will fail.

---

## 5) Firebase Console setup

Project: `iptvweb-f0745`

1. Enable **Authentication → Anonymous**
2. Create **Realtime Database** in `europe-west1`
3. Apply `database.rules.json`
4. Enable **Hosting**
5. Enable **Functions** (Blaze plan may be required)

---

## 6) Run locally

Frontend:

```bash
npm run dev
```

Build check:

```bash
npm run build
```

---

## 7) Deploy

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

## 8) API routes used by frontend

All proxied by Firebase Function `api`:

- `GET /api/categories?type=live|movie|series`
- `GET /api/streams?type=...&category_id=...`
- `GET /api/series/:seriesId`
- `GET /api/epg?stream_id=...&limit=...`

Auth: frontend sends Firebase ID token in `Authorization: Bearer ...`.
Function reads playlist credentials from `users/{uid}/settings/playlist`.

---

## 9) GitHub push (if needed)

```bash
git add .
git commit -m "Update deployment/security config"
git push origin main
```

---

## 10) Security hardening checklist

1. In Google Cloud Console → APIs & Services → Credentials → your Firebase Web API key:
   - Add **Application restrictions**: HTTP referrers limited to your Firebase Hosting domain(s)
   - Add **API restrictions**: only required Firebase APIs
2. Keep Realtime Database rules user-scoped (already configured in `database.rules.json`).
3. If a key was exposed in history, rotate/regenerate it and update local/CI env variables.

---

## 11) Why GitHub Pages can show a blank page

If GitHub Pages is publishing from repository **root** (`main` + `/`), it serves source files,
while this project requires a Vite production build (`dist`).

- Source `index.html` imports `/src/main.tsx` (development entry), which is not a production bundle.
- GitHub Pages also does not provide Firebase Hosting rewrites for `/api/*`.

Use **Firebase Hosting** for this project to avoid both issues.

---

## Notes

- UI is ready and extensible (dark modern layout)
- You can later add:
  - better EPG timeline UI
  - watchlist notifications
  - offline caching strategy improvements
