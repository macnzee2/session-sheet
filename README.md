# Session Sheet

A youth football coaching planner: sessions, drills, coaching methods, and
Match Day squad/rotation planning — backed by Supabase so it genuinely syncs
across every device in real time.

## 1. Create the Supabase project

1. Go to https://supabase.com, sign in, and click **New project**.
2. Pick a name (e.g. `session-sheet`), a database password (save it somewhere —
   you won't need it day-to-day, but keep it safe), and a region close to you.
3. Wait ~1-2 minutes for it to finish provisioning.

## 2. Create the database tables

1. In your new project, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase_schema.sql` (included in this project) and paste its entire
   contents in.
4. Click **Run**.

That one script creates all 9 tables the app needs:

| Table        | What it stores                                             |
|--------------|--------------------------------------------------------------|
| `categories` | Drill categories (Warm-up, Shooting, Passing…)               |
| `teams`      | Your team names (Squad, Team A, Team B…)                     |
| `drills`     | Every drill, its category, optional theme, description, uses |
| `methods`    | Coaching methods and their ordered phases                    |
| `sessions`   | Planned/completed training sessions                          |
| `ratings`    | Star ratings you've given drills after sessions              |
| `players`    | Your squad, team membership, games played, position counts   |
| `formats`    | Game formats (4v4, 5v5…) and their positions                 |
| `matchdays`  | Match days, who's present, and each game's rotation plan      |

It also turns on **Realtime** for every table (so changes on one device push
to another live) and enables **Row Level Security** with a permissive
"allow everything" policy — reasonable for a personal/family tool with no
login system. If you ever add real user accounts, tighten these policies
later.

## 3. Get your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **`anon` `public`** key (not the
   `service_role` key — that one's secret and should never go in frontend
   code).

## 4. Run it locally

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local` and paste in your values:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Then:

```bash
npm run dev
```

Open the printed local URL. The first time it loads with an empty database,
it seeds itself with the default drills, methods, categories, formats and
teams automatically — you don't need to add those by hand.

## 5. Deploy to Vercel

1. Push this project to a GitHub repo (Vercel deploys from Git).
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <your-empty-github-repo-url>
   git push -u origin main
   ```
2. Go to https://vercel.com, **Add New → Project**, and import that repo.
   Vercel auto-detects it as a Vite project — no config needed.
3. Before deploying, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → your Project URL
   - `VITE_SUPABASE_ANON_KEY` → your anon public key
4. Click **Deploy**.

Once it's live, that URL works the same on your phone and desktop — same
database, same data, live-updating, no manual sync step of any kind.

## Notes

- **Realtime**: any change made on one device (adding a player, saving a
  session, marking a game played) is pushed to every other open tab/device
  within about a second, via Supabase's realtime subscriptions.
- **Security**: the `anon` key is safe to expose in frontend code — that's
  what it's for — but because the RLS policies here allow anyone with the
  URL to read/write, don't share the live link publicly unless you're happy
  with that. If this ever needs to be properly private, the next step is
  adding Supabase Auth and scoping the policies to a logged-in user.
- If you ever see the small amber banner about not reaching Supabase, it
  means the app couldn't fetch data at all — almost always the env vars
  being missing/wrong, or the SQL script not having been run yet.
