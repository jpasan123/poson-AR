# JENDO Poson AR

Web AR experience — scan JENDO logo or building facade to see 3D models.

**Tech:** MindAR · Three.js · Blender GLB models

## Live URLs

| Platform | URL |
|---|---|
| **Vercel** | Connect repo in Vercel dashboard (HTTPS + custom domain) |
| **VPS** | `https://168.144.40.152:8443/` |

## AR Locations

| Scan target | Model |
|---|---|
| JENDO Logo | Poson Lantern |
| JENDO Building | Building 3D |

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import `jpasan123/poson-AR`
4. Settings (auto-detected from `vercel.json`):
   - **Output Directory:** `public`
   - **Build Command:** (leave empty)
5. Deploy → you get `https://your-project.vercel.app`
6. Optional: add custom domain in Vercel → **Domains**

Camera requires **HTTPS** — Vercel provides this automatically.

## Deploy to VPS

```bash
SSHPASS='your-password' ./scripts/deploy.sh
```

Only updates `/var/www/ar-model` on the server.

## Add a new AR location

1. Add training photo + GLB to `assets/`
2. Copy GLB to `public/assets/models/`
3. Append photo in `scripts/targets-manifest.js`
4. Add entry in `public/js/ar-config.js` → `LOCATIONS`
5. Recompile targets:
   ```bash
   node scripts/compile-browser.js
   ```
6. Push to GitHub (Vercel auto-deploys) **and/or** run `./scripts/deploy.sh`

## Local dev

```bash
npm run serve
# open https://localhost:3000 — use ngrok or similar for phone camera testing
```

## Project structure

```
public/           ← web root (Vercel + nginx)
  index.html
  ar.html
  targets.mind
  targets-building.mind
  targets-poson.mind
  assets/models/
  js/ar-config.js ← location registry
assets/           ← source images for MindAR compile
scripts/          ← compile + deploy
```
