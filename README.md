# Waterjet Production Manager — Version 1

A static website for shared waterjet job scheduling (5:00 AM–5:00 PM availability, with 8 hours as standard planned capacity), OMEX estimate imports, cutting-session tracking, history, and weekly reports.

## Included in this first version

- Weekly calendar with drag/drop and resize using FullCalendar.
- Unscheduled job list; drag a job onto the calendar.
- Job creation, editing, search, status, material, thickness, quantity, priority, notes.
- OMEX AI Assistant: paste one report at a time, analyze it through a Supabase Edge Function, review/edit extracted fields, then save to a new or existing job.
- Original OMEX text is retained with parsed JSON values and AI extraction metadata.
- Start, pause, resume, complete controls.
- Manual cutting-session entry for restarts and corrections.
- Actual cutting time is summed across sessions; paused gaps are excluded.
- Weekly report with actual timer hours, OMEX estimated garnet/cost, charts, CSV export.
- Print schedule and report / save as PDF.
- Supabase shared database connection and realtime refresh.
- Local browser mode for initial UI testing only.

## Important limitations in Version 1

1. This is a starter implementation, not yet a validated production system. Test with sample records before relying on it.
2. No-login mode with public write policies means anyone who can access the website and public Supabase endpoint can change or delete records. Do not use confidential company data without employer approval. For real company deployment, strongly consider at least a shared access password / authenticated accounts or network restrictions.
3. Local mode saves only in the current browser. It does not sync between computers. Configure Supabase on every computer for shared records.
4. Reports currently treat OMEX cost and abrasive as estimates. Actual garnet and actual cost entry, material inventory, audit logs, and advanced report filters are planned follow-ups.
5. A job may have multiple actual cutting sessions. Do not leave an active timer running overnight; pause it at the end of each session and resume manually at the next start time.
6. This version uses CDN libraries, so the website needs an internet connection to load those libraries.
7. A report spanning multiple dates counts a session by its start date in the daily chart. If a session crosses midnight, split it into separate sessions for precise day-by-day totals.

## OMEX AI Assistant setup (required for AI analysis)

The browser does not contain an OpenAI secret. AI extraction runs on a Supabase Edge Function so the API key stays server-side.

1. Make sure the project folder includes `supabase/functions/parse-omex/index.ts` and `supabase/config.toml`.
2. Install the Supabase CLI and sign in: `supabase login`.
3. Link this local project to your Supabase project: `supabase link --project-ref YOUR_PROJECT_REF`.
4. Add your OpenAI API key as a Supabase secret (never paste it into GitHub or the website):
   `supabase secrets set OPENAI_API_KEY=YOUR_OPENAI_API_KEY`
5. Deploy the function:
   `supabase functions deploy parse-omex`
6. Keep `OPENAI_MODEL` optional; the function defaults to `gpt-4.1-mini`. If needed, set it as a Supabase secret.
7. Reload the website, connect the Supabase URL and publishable/anon key under Settings & Data, open Jobs & History, choose **Import OMEX**, paste one report, and select **Analyze with AI**.
8. Review and correct the extracted values, enter a job name, and choose **Save statistics to job**.

The AI function does not write to the database. Only the explicit Save action writes the reviewed information to the selected/new job. The original pasted report is stored with that job.

**Public endpoint warning:** this no-login prototype sets `verify_jwt = false` so the browser can call the function without a user account. Anyone who discovers the public function endpoint may be able to make AI requests that consume your API quota. Before using it with real company data, get employer approval and add authentication or an access-control/rate-limit layer. Never put the OpenAI API key in frontend JavaScript, `.env` committed to GitHub, or the public repository.

## 1. Create the GitHub repository

1. Sign in at https://github.com.
2. Create a repository named `waterjet-production-manager`.
3. Upload all files and folders from this project, preserving the folder structure.
4. Commit the files.

## 2. Test locally

Because the page loads JavaScript modules from CDN, use a local web server rather than opening the HTML file directly. For example, with Python installed:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

Local browser mode is for testing only; it does not sync with another computer.

## 3. Create the shared Supabase database

1. Create a project at https://supabase.com.
2. Open SQL Editor.
3. Open `supabase/schema.sql` from this project.
4. Copy the entire SQL file into the SQL Editor and run it.
5. In Project Settings → API, copy the Project URL and the publishable/anon key.
6. In the website, open Settings & Data.
7. Paste the URL and key, then click Connect / Save connection.
8. Repeat the connection setup on the supervisor's computer.

The key used in frontend code must be the publishable/anon key only. Never place a service-role or secret key in website code.

## 4. Enable and verify Realtime

The SQL attempts to add both tables to the `supabase_realtime` publication. In Supabase, check Database → Replication / Publications and confirm `jobs` and `cut_sessions` are enabled for Realtime. Reload the website on both computers and test by creating a sample job on one computer.

## 5. Publish with GitHub Pages

1. Open repository Settings → Pages.
2. Under Build and deployment, choose Deploy from a branch.
3. Select `main` and `/ (root)`.
4. Save.
5. Wait for GitHub Pages to publish.
6. Open the generated Pages URL.

Every person can use the same website URL. Each browser needs the Supabase URL and publishable key entered once. The app stores those connection details in that browser's local storage.

## 6. First test checklist

Use fake jobs first:

- Create a job and refresh the page.
- Drag an unscheduled job onto a weekday.
- Move it to another day and verify the new date on the other computer.
- Paste the sample OMEX report and confirm 11.9575 hours, $3180.70, 551.15 lb, 1808 pierces, and 545.70 cutting minutes are extracted. Confirm the AI preview can be edited and nothing is saved until you click Save statistics to job.
- Start a timer, pause it, and resume it later.
- Add a manual session with a past start/end time.
- Confirm actual time is the sum of sessions, not the gap between sessions.
- Generate a report and print to PDF.
- Export CSV and JSON backups.

## 7. Known next improvements

- Add edit/correction for existing sessions, not just delete and re-enter.
- Add audit log of who changed what (not possible to attribute people reliably in anonymous mode).
- Add actual garnet and actual cost fields.
- Add job attachments and source-file import options if OMEX supports them.
- Add stronger public-function abuse protection before wider company use.
- Add machine downtime, holidays, shift capacity, and daily capacity visualization.
- Improve report date attribution for sessions crossing midnight.
- Add conflict handling for two people editing the same job simultaneously.
- Add server-side backup schedule and restore drills.
- Add tests for OMEX parsing and calculations.
