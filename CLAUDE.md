# Family Dashboard — CLAUDE.md

This file gives Claude Code full context for the Browning Family Dashboard project. Read this before making any changes.

---

## What This Project Is

A mobile-first Progressive Web App (PWA) hosted on GitHub Pages that serves as a daily family briefing dashboard. A Claude routine runs on a schedule, gathers data (calendar, email, priorities, home admin), formats it as JSON, and POSTs it to a Supabase database. The dashboard fetches and displays that data with live weather, a live Google Calendar integration, and voice-powered event creation.

**Live URL:** https://chaunceyhoyt.github.io/family-dashboard/
**GitHub repo:** https://github.com/chaunceyhoyt/family-dashboard

---

## File Structure

```
index.html        — The entire dashboard (single file app)
manifest.json     — PWA manifest for home screen install
CLAUDE.md         — This file
```

Supporting files (not in repo, stored locally at C:\Quanta\dashboard-files\):
```
routine-prompt.md — The Claude routine prompt (paste into scheduled routine)
supabase-setup.sql — Original DB setup SQL (already applied)
```

---

## Infrastructure

### GitHub Pages
- Repo: `chaunceyhoyt/family-dashboard` (public)
- Branch: `main`, root folder
- URL: https://chaunceyhoyt.github.io/family-dashboard/

### Supabase
- Project ID: `qhvzfgsfkqrnykgryvej`
- Project URL: `https://qhvzfgsfkqrnykgryvej.supabase.co`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFodnpmZ3Nma3FybnlrZ3J5dmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMzk1NjIsImV4cCI6MjA5NTgxNTU2Mn0.WbXMQaEfaewGarq7W4-hgp74OQuQtwpDNpxSzc-jNA4`
- Region: us-east-1
- MCP server is connected (tools: `mcp__4e62b38a-72b3-4dd1-9558-ee0207e0a0df__*`)

### Supabase Database Schema

```sql
create table briefings (
  id         uuid        default gen_random_uuid() primary key,
  type       text        not null,   -- 'daily' | 'weekly' | 'weekend' | 'monthly'
  date       date        not null default current_date,
  app_token  text        not null default 'fdb_browning_2026',
  content    jsonb       not null,
  created_at timestamptz default now()
);
create unique index briefings_type_date_idx on briefings (type, date);
```

### Supabase RLS Policies
- **SELECT**: requires `auth.role() = 'authenticated'` — only Google-authenticated users can read
- **INSERT**: open to anon role — the routine POSTs with the anon key
- The `app_token` field (`fdb_browning_2026`) is included in every insert as an extra layer

### Google OAuth (Authentication)
- Provider: Google via Supabase Auth
- Google Cloud Project: `Family Dashboard`
- Client ID: `501503249075-6idd7r9ce3631uneomoccg76ouumc7e8.apps.googleusercontent.com`
- Supabase redirect URI: `https://qhvzfgsfkqrnykgryvej.supabase.co/auth/v1/callback`
- Dashboard redirect URI: `https://chaunceyhoyt.github.io/family-dashboard/`
- Allowed users: managed via Google Cloud Console → OAuth consent screen → Test Users
- OAuth scopes requested: `https://www.googleapis.com/auth/calendar`
- Google Calendar API: enabled in Google Cloud Console

---

## Architecture Overview

```
Claude Routine (scheduled)
  → gathers calendar, email, priorities, home admin
  → formats as JSON
  → POSTs to Supabase via Python script (anon key + app_token)
  → sends brief Slack notification with dashboard link

Dashboard (index.html on GitHub Pages)
  → Google Sign-In (OAuth via Supabase Auth)
  → fetches briefings from Supabase (authenticated)
  → fetches live weather from Open-Meteo API (no key needed)
  → fetches live calendar events from Google Calendar API (provider_token)
  → renders daily/weekly/weekend/monthly views
  → voice event creation via Chrome Web Speech API
  → manual event creation via form modal
```

---

## Dashboard Features

### Authentication
- Google Sign-In button on login screen
- Session persists via Supabase Auth (localStorage)
- Auto-locks on sign-out
- Sign-out button (⎋) in header
- User email shown in header after login
- `gcalToken` stored in `sessionStorage` — available right after sign-in, cleared on tab close

### Daily Tab
- Live weather card (Open-Meteo, Chesapeake VA coords: 36.7682, -76.2875)
  - Current temp, feels like, high/low, rain %, humidity, wind
  - Red storm warning banner if rain probability ≥ 50% or storm weather code
- Today's Calendar card (live from Google Calendar API)
  - Events tappable → open in Google Calendar (`htmlLink`)
  - 🎤 mic button for voice event creation
  - `+` button for manual form entry
- Briefing sections from Supabase (priorities, schedule, family, emails, home, ahead)
  - Collapsible cards, colored dots (urgent=red, action=yellow, success=green, info=grey)
  - Gmail links open specific threads: `https://mail.google.com/mail/u/0/#inbox/THREAD_ID`

### Weekly Tab
**Portrait mode:**
- Horizontal scrollable day strip (Mon–Sun)
- Each pill: day name, date, weather emoji, high/low, event count dots
- Tap a day → selected day events appear below
- 🎤 + `+` buttons on selected day header
- Weekly briefing recap sections below

**Landscape mode** (triggered by `orientationchange`, not `resize`):
- 7-column grid, all days visible
- Each column: day name, date, weather, event chips (tappable), 🎤 + Add buttons
- Today highlighted in blue

### Voice Event Creation
- Uses Chrome Web Speech API (`window.SpeechRecognition || window.webkitSpeechRecognition`)
- Triggered by 🎤 button on any day (daily card, weekly portrait, weekly landscape)
- Full-screen overlay with pulsing blue ring animation
- Live transcript shown as user speaks
- On finish: client-side parser extracts title, date, time, location
- Confirmation card shown before anything is posted
- Confirm → POST to Google Calendar API → dashboard refreshes
- "Try Again" re-opens microphone
- Works on Chrome tablets (Android)

**Voice parser handles:**
- Days: today, tomorrow, Monday–Sunday, next [day]
- Months: June 4th, March 15, etc.
- Times: 10am, 2:30pm — assumes PM for hours 1–6 with no am/pm specified
- All day: "all day"
- Location: "at [place name]" patterns
- Strips filler: add, create, schedule, set up, new event

### Weekend Tab
- Briefing sections only (no live calendar — weekend briefing is generated Thursday)

### Monthly Tab
- Briefing sections only

---

## Briefing JSON Schema

The routine POSTs this structure to Supabase. The `content` field is JSONB.

```json
{
  "briefing_type": "daily",
  "subtitle": "Saturday, May 31, 2026",
  "sections": [
    {
      "id": "priorities",
      "emoji": "🚨",
      "title": "Today's Priorities",
      "collapsed": false,
      "items": [
        {
          "type": "urgent",
          "text": "Electric bill due today",
          "detail": "Optional detail line",
          "time": null,
          "link": "https://dominionenergy.com",
          "link_label": "Pay now"
        }
      ]
    }
  ]
}
```

**Item types:** `urgent` (red), `action` (yellow), `success` (green), `info` (grey)

**Section IDs used in daily:** priorities, schedule, family, emails, home, ahead
**Note:** weather section is skipped in rendering — dashboard fetches live weather instead

**Supabase INSERT record structure:**
```json
{
  "type": "daily",
  "date": "2026-05-31",
  "app_token": "fdb_browning_2026",
  "content": { ...the JSON above... }
}
```

---

## Claude Routine

Runs on a schedule. Generates daily/weekly/weekend/monthly briefings.

**Report schedule:**
- Every day: Daily Briefing
- Sunday: Weekly Briefing
- Thursday: Weekend Briefing (+ meal plan email to chaunceyhoyt@gmail.com)
- 1st of month: Monthly Briefing

**Key routine instructions:**
- Weather: skip — dashboard fetches live from Open-Meteo
- Emails: include Gmail thread links (`https://mail.google.com/mail/u/0/#inbox/THREAD_ID`)
- Schedule events: include Google Maps links for physical locations
- Output: structured JSON → Python POST to Supabase → brief Slack notification

**Python POST template (Step 2 of routine):**
```python
python3 << 'PYEOF'
import json, urllib.request, datetime

SUPABASE_URL = 'https://qhvzfgsfkqrnykgryvej.supabase.co/rest/v1/briefings'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'  # full key above
APP_TOKEN    = 'fdb_browning_2026'
briefing_type = 'daily'  # or weekly | weekend | monthly

content = { ... }  # Step 1 JSON as Python dict

record = {
    "type": briefing_type,
    "date": datetime.date.today().isoformat(),
    "app_token": APP_TOKEN,
    "content": content,
}
body = json.dumps(record, ensure_ascii=False).encode("utf-8")
req  = urllib.request.Request(SUPABASE_URL, data=body, method="POST")
req.add_header("apikey",        SUPABASE_KEY)
req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
req.add_header("Content-Type",  "application/json")
req.add_header("Prefer",        "resolution=merge-duplicates")
urllib.request.urlopen(req)
print("Posted successfully")
PYEOF
```

**Slack notification (Step 3):**
```
☀️ Daily Briefing is ready
https://chaunceyhoyt.github.io/family-dashboard/
Top priority: [single most urgent item]
```

---

## Weather Config

- API: Open-Meteo (free, no key)
- Location: Chesapeake, VA
- Coordinates: lat=36.7682, lon=-76.2875
- Timezone: America/New_York
- Units: Fahrenheit, mph
- Daily view: fetches current + 2-day forecast
- Weekly view: fetches 7-day forecast using `start_date` / `end_date` params
- Storm codes that trigger warning banner: 51,53,55,61,63,65,80,81,82,95,96,99

---

## Known Issues & Decisions

- **Google Calendar token**: `provider_token` is only available immediately after OAuth sign-in. On page refresh it may be null. Dashboard shows "needs re-sign in" with a button when this happens. This is a Google/Supabase security limitation — not fixable without a backend.
- **Orientation detection**: uses `orientationchange` event (not `resize`) to avoid scroll-triggered re-renders on mobile Chrome.
- **Emoji in routine**: routine must use Python (not curl) to POST JSON — curl mangles emoji in shell environments. `ensure_ascii=False` in Python preserves them.
- **Unique constraint**: `briefings_type_date_idx` on (type, date) — use `Prefer: resolution=merge-duplicates` header to upsert instead of duplicate insert.
- **GitHub repo is public**: anon key is safe to expose because Supabase RLS requires Google auth for all reads. The anon key can only INSERT (for the routine).

---

## Adding New Family Members

Google Cloud Console → APIs & Services → OAuth consent screen → Test Users → Add their Gmail address.

---

## Common Tasks

**Push a dashboard change:**
1. Edit `index.html` locally
2. Upload to GitHub repo (replace existing file)
3. Wait ~60 seconds for GitHub Pages to deploy

**Test a briefing manually:**
Use the Supabase MCP (`execute_sql`) to INSERT a test record directly.

**Change the family name:**
Two places in `index.html`: `<title>` tag and the `<h1>` in the header.

**Add a new briefing type:**
1. Add to `TYPE_LABELS` object in JS
2. Add sections to routine prompt
3. Add rendering logic if it needs a special layout (like weekly)

---

## Tech Stack Summary

| Layer | Tool | Notes |
|---|---|---|
| Hosting | GitHub Pages | Free, public repo required |
| Database | Supabase (PostgreSQL) | Free tier, JSONB content |
| Auth | Supabase Auth + Google OAuth | Calendar scope included |
| Weather | Open-Meteo API | Free, no key |
| Calendar | Google Calendar API v3 | Uses OAuth provider_token |
| Voice | Chrome Web Speech API | Android Chrome only |
| Frontend | Vanilla HTML/CSS/JS | No framework, single file |
| Routine | Claude scheduled agent | Posts JSON to Supabase |
