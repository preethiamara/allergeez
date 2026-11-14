# AllergyAid

Label scanning (Gemini vision), voice-guided reaction mode (ElevenLabs), profiles and reaction logs (Neon).

## Setup
    cp .env.example .env.local   # fill in keys
    psql "$DATABASE_URL" -f schema.sql
    npm install && npm run dev

