# Deployment Guide — Standalone Android App

This guide takes you from "runs on my laptop" to "installable APK on my phone,
backed by a cloud API." Two halves, both free:

  1. **Backend → Render** (always-on cloud API) + **Supabase** (PostgreSQL database)
  2. **Mobile → EAS Build** (installable Android APK)

Local dev keeps working unchanged throughout (`__DEV__` points the app at your
LAN IP; `DATABASE_URL` unset → SQLite).

---

## Prerequisites

- A GitHub account + your code pushed to a GitHub repo
- An Expo account (free) — sign up at https://expo.dev
- A Supabase project (free) — https://supabase.com
- The model file committed at `backend/models/best.onnx` (or `.pt`) — Render
  builds from the repo, so it must be in Git, not just on disk. Large files
  may need [Git LFS](https://git-lfs.com); see Troubleshooting below.
- Your `GEMINI_API_KEY` ready (from https://aistudio.google.com/apikey)

---

## Part 1 — Deploy the backend to Render (~20 min)

Render deploys your `backend/Dockerfile` directly from GitHub.
The database is hosted separately on **Supabase** (free PostgreSQL 17).

### 1.1 Create the Web Service
1. Go to https://dashboard.render.com → **New +** → **Web Service**
2. Connect your GitHub account and select your FoodAnalyzer repo
3. Configure:
   - **Name:** `foodanalyzer` (or any name — this becomes your URL)
   - **Region:** closest to you
   - **Branch:** `main` (or wherever your code lives)
   - **Root Directory:** `backend`  ← important, so the Dockerfile is found
   - **Runtime:** Docker (auto-detected from `backend/Dockerfile`)
4. **Instance Type:** Free

### 1.2 Set up Supabase PostgreSQL
1. Go to https://supabase.com → create a new project (free tier)
2. Once created, go to **Project Settings → Database → Connection string → URI**
3. Copy the connection string (looks like
   `postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`)

### 1.3 Wire the database + secrets into the Render web service
Back on your Render Web Service → **Environment** tab, add:
- `DATABASE_URL`  → paste the **Supabase** PostgreSQL connection string
- `GEMINI_API_KEY` → your Gemini key

> **Important:** The `DATABASE_URL` now points to Supabase, NOT to a Render
> Postgres instance. This means your data persists independently of Render
> and won't be affected if the Render service is redeployed or recycled.

### 1.4 Deploy & verify
1. Click **Create Web Service** / **Manual Deploy**
2. Wait for the build (~5–10 min — the image is large due to torch/onnxruntime)
3. Once live, visit `https://foodanalyzer.onrender.com/` → you should see:
   ```json
   {"service":"Food Intelligence Analyzer","version":"1.0.0","status":"healthy","docs":"/docs"}
   ```
4. Confirm the DB connected: visit `/health/warmup` — `db_ok` should be `true`

> **Note:** Free Render services spin down after 15 min of inactivity. The
> first request after idle takes ~30s to wake up. Normal for free tier.

---

## Part 2 — Build the Android APK with EAS (~30 min, mostly build time)

### 2.1 Point the app at your Render URL
Edit `mobile/services/api.ts` → set `PROD_BASE_URL` to your Render URL:
```ts
const PROD_BASE_URL = 'https://foodanalyzer.onrender.com';
```
Commit + push this change.

### 2.2 Install + log in to EAS
```bash
cd mobile
npm install -g eas-cli
eas login        # use your Expo account
```

### 2.3 Configure the project
```bash
eas build:configure
```
This populates `extra.eas.projectId` in `app.json` (already structured for it).
Commit the changes it makes.

### 2.4 Build the APK
```bash
eas build --platform android --profile preview
```
- `--profile preview` uses the `eas.json` "preview" config → produces a `.apk`
  (sideloadable), not an App Store `.aab` bundle.
- Build runs on Expo's cloud (~10–15 min). You'll get a download URL when done.

### 2.5 Install on your phone
1. Download the `.apk` from the EAS dashboard link
2. Transfer it to your phone (USB, Google Drive, etc.)
3. On Android: open the `.apk` → it'll prompt you to allow "Install unknown apps"
   for your file manager → enable and install
4. Open **Food Intelligence** from your app drawer

---

## Verifying it works end-to-end

1. With the app open on mobile data (NOT your home WiFi), tap **Scan**
2. Photograph a dish → wait for analysis
3. Confirm you get back detected foods + nutrition

If it works on mobile data, you're fully standalone — no computer involved.

---

## Updating later

- **Backend code change:** push to GitHub → Render auto-redeploys
- **Mobile code change:** re-run `eas build --platform android --profile preview`,
  install the new APK
- **Change backend URL in the app:** edit `PROD_BASE_URL` in `api.ts`, rebuild

---

## Architecture

```
┌──────────────┐     HTTPS     ┌──────────────────┐   DATABASE_URL   ┌──────────────┐
│  Mobile App  │ ────────────→ │  Render (FastAPI) │ ───────────────→ │   Supabase   │
│  (EAS APK)   │               │  Backend Server   │                  │  PostgreSQL  │
└──────────────┘               └──────────────────┘                  └──────────────┘
```

---

## Troubleshooting

### "API key not valid" or 500s on first deploy
- Confirm `GEMINI_API_KEY` and `DATABASE_URL` are set in Render → Environment
- Check Render → **Logs** tab for the `[Gemini]` and `[DB]` startup lines

### App can't connect ("Network error")
- Verify `PROD_BASE_URL` in `api.ts` matches your Render URL **exactly**
  (including `https://`, no trailing slash)
- Render free tier may be asleep — retry after 30s

### Database resets on every deploy
- You're missing the `DATABASE_URL` env var, so the app fell back to SQLite
  (which lives on Render's ephemeral disk). Set `DATABASE_URL` to your
  Supabase PostgreSQL connection string and redeploy.

### Build fails: "model file too large for Git"
- `best.onnx` (~13MB) should be fine, but `best.pt` (~7MB) plus `.db` files
  add up. Use [Git LFS](https://git-lfs.com) for anything over 50MB, or
  download the model at build time in the Dockerfile.

### Render build is very slow
- The image is ~3-4GB (torch + onnxruntime + ultralytics). This is expected.
  If you switch to ONNX-only inference, you can drop `ultralytics` + `torch`
  from `requirements.txt` to shrink it dramatically.

---

## File changes made for deployment

| File | Change |
|---|---|
| `backend/core/database.py` | `DATABASE_URL` env var takes precedence over config.yaml (Render injects Supabase URL) |
| `backend/.env` | Contains `DATABASE_URL` (Supabase) + `GEMINI_API_KEY` for local dev |
| `backend/requirements.txt` | Includes `psycopg2-binary` (Postgres driver) |
| `mobile/services/api.ts` | `BASE_URL` switches on `__DEV__` (dev=LAN IP, prod=Render URL) |
| `mobile/app.json` | Added `android.package`, `ios.bundleIdentifier`, app name, EAS projectId placeholder |
| `mobile/eas.json` | EAS build profiles (preview=APK, production=AAB) |
