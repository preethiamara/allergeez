# AllergyAid

Label scanning (Gemini vision), voice-guided reaction mode (ElevenLabs), profiles and reaction logs (Neon).

## Setup
    cp .env.example .env.local   # fill in keys
    psql "$DATABASE_URL" -f schema.sql
    npm install && npm run dev

## Hackathon rule
No commits before Sat Nov 14, 10:30 AM or after Sun Nov 15, 12:00 PM (disqualification). Do not run `git init` / push until hacking starts.

## Not built yet
Mastra agent orchestration, Bright Data recall scraping, Vultr deploy, SMS automation.
