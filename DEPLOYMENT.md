# Deploying Pick Six

Current stack: **Supabase** (Postgres) + **Render** and/or **Cloud Run**
(backend API, can run either or both in parallel) + **Vercel** (frontend) +
**GitHub Actions** (scheduled ingestion, runs directly against Postgres on
GitHub's own runners — not routed through the backend).

## 1. Database → Supabase

Create a project at [supabase.com](https://supabase.com). From
**Project Settings → Database**, copy the **Transaction pooler** connection
string (port 6543) — this app opens many short-lived connections (every
request, every GitHub Actions run), and the pooler is built for that.

Apply the schema:

```bash
DATABASE_URL=<your connection string> .venv/bin/python -m backend.database
```

## 2. Backend

Required environment variables, either host:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase pooler connection string from step 1 |
| `JWT_SECRET` | yes | `openssl rand -hex 32` |
| `CRON_SECRET` | yes | `openssl rand -hex 32`, a different value |
| `CORS_ORIGINS` | yes | your frontend's origin, e.g. `https://your-app.vercel.app` |
| `OPENAI_API_KEY` | no | enables the news-headline signal (`backend/news.py`) |
| `ANTHROPIC_API_KEY` | no | enables LLM-written pick explanations (`backend/analysis.py`) |
| `ADMIN_EMAILS` | no | comma-separated list of emails with admin access; defaults to one hardcoded address in `backend/auth.py` |

### Render

Render dashboard → **New → Blueprint**, point it at this repo — it reads
`render.yaml` and prompts for the env vars above. Render spins the free tier
down after 15 minutes idle (~20-30s cold start on the next request); the
cheapest paid tier removes that.

### Cloud Run

Builds from the repo's `Dockerfile` (respects the `PORT` env var Cloud Run
injects). From the repo root, with `gcloud` authenticated:

```bash
gcloud run deploy gridiron-edge-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances=2 \
  --env-vars-file=path/to/your/env.yaml
```

Cloud Run's free tier covers this app's traffic comfortably, but a billing
account (card on file) is required even to stay within it. `--max-instances`
caps worst-case cost if traffic ever spikes unexpectedly.

## 3. Frontend → Vercel

```bash
cd frontend
npm i -g vercel
vercel
```

Vercel's CLI does not auto-deploy on `git push` for this project — redeploy
explicitly with `vercel --prod` after any change. Set one env var in the
Vercel project settings:

- `VITE_API_BASE` = your backend's URL + `/api` (Render or Cloud Run, whichever is live)

Vite bakes env vars in at build time, so redeploy after changing it.

## 4. Keep data fresh: GitHub Actions

`.github/workflows/cron.yml` runs `ingestion/tick.py` jobs directly on
GitHub-hosted runners against Supabase — not through the backend. One repo
secret required (Settings → Secrets and variables → Actions):

- `DATABASE_URL` — same value as the backend's

Runs automatically once on the default branch. Trigger a job manually to
confirm it's wired up: Actions tab → "Gridiron Edge data ticks" → Run
workflow → pick a job from the dropdown.

## 5. Invite people

Send them the Vercel URL. Each person signs up with their own email/password
on `/login`; picks and records are private per account.
