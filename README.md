# Allergeez 💗

**Your food & reaction buddy for food allergies.** Snap a meal, test a food before you eat it, find safe dishes at restaurants nearby, log reactions by just talking to Gee, and get calm, voice-guided help in an emergency.

**Live demo:** https://45-77-123-15.sslip.io

> AllerGeez helps you notice patterns. It is **not** medical advice and can't diagnose an allergy. In an emergency, use your epinephrine and call 911.

---

## What it does

### 🍽️ Record meals
- **Photo, camera, or typing**: Gemini reads the plate, package or ingredient label and lists the ingredients.
- **Packaged foods** are matched to the real product (barcode → brand + name) in Open Food Facts through Bright Data. If the database doesn't have it, AllerGeez **searches the web for the actual label** (brand site or retailer) and reads it.
- Flags **your allergens** (including hidden names like casein, whey, tahini), common allergy groups, **food additives** (sulfites, Red 40, MSG, preservatives, sweeteners) and **natural triggers** (histamine, nickel, salicylates, tyramine).
- Photos that aren't food are rejected with a "retake / choose another photo" prompt.
- Log meals for **any time**, not just now.

### 🎯 Food Checker (Food-O-Radar!)
- **Find food near me**: a live map with places within 0.5–10 miles. Each place gets its **Google rating** and **menu**, read through Bright Data, and every dish is ranked for *you*: ✅ great / OK, ⚠️ ask first, ❌ avoid (with the reason).
- **Check a restaurant**: paste a menu link or snap a menu photo and get the dishes that are safe for you.
- **Describe a meal**: type it or upload a plate photo for an instant safety check (a green / yellow / red heart with a "% safe" score).
- Matching uses your allergens (with spelling fixes, like "avacado" → avocado), **hidden ingredients** (guacamole → avocado, pesto → pine nuts, Caesar → anchovy), your **diet** (vegetarian, vegan, gluten-free…), and your **taste profile** (things you like plus what you usually log). Dishes are checked against ingredients, never just AI tags.

### 🗣️ Record a reaction: Talk to Gee
- Tap Gee and describe what's happening. **ElevenLabs** transcribes you and Gee answers out loud.
- Gee is a **Mastra agent**: it asks only for what's missing (symptoms → timing → severity → food → duration), flags emergencies, links the meals you logged before the reaction, and runs the **likely-irritant algorithm** over your history.
- Gee **remembers** past check-ins (Mastra memory stored in Neon) and points out repeat patterns ("You had hives after shrimp last time too").
- AI **attack tags** title each reaction ("Hives & swelling"), and the saved conversation is viewable in Reaction history.

### 🚨 Emergency guide ("Talk me through it")
- One screen, voice-guided: epinephrine → call 911 → lie down → get someone → watch the 5-minute timer.
- **Talk or type to Gee** at any time. Urgent phrases ("I used my EpiPen", "my throat is closing") get an instant answer on the device; anything else is answered by Gemini using your allergens and recent meals ("The pad thai you ate contains peanuts…"). It also recognizes song lyrics and TV as background noise.
- **Inactivity alarm**: if you stop responding for 60 seconds, Gee asks "Are you okay?". After 20 more seconds a siren sounds and a help card tells bystanders what to do. It stops with "I'm OK", or turns itself off after 2 minutes.
- Real **Call 911**, call / text your emergency contact.

### 🔍 Allergens & patterns
- Your allergen list, checked so only things you **eat or drink** are accepted (pollen, dust and pets are explained instead), with "did you mean…?" for typos.
- **Likely irritants** ranked from your meals and reactions: explainable scoring (how often a food comes before a reaction, severity, speed), with confidence levels.

### 👤 Optional account
- Use it without signing in: each browser gets its own **private guest profile**. Sign up (email or Google, via Neon Auth) to keep your history; your guest data moves into your account.

---

## How each sponsor tool is used

| Tool | Where it's used |
|---|---|
| **Gemini** | Reads food photos, ingredient labels and menu photos; classifies packaged vs homemade food and rejects non-food; flags allergens, additives and natural triggers; reads restaurant menus and web labels; answers Gee in the emergency chat; runs the Mastra agent |
| **ElevenLabs** | Gee's voice (text-to-speech, `eleven_flash_v2_5` for low latency) and hearing you (Scribe speech-to-text) in Talk to Gee and the emergency guide, with a device-voice fallback |
| **Neon** | Postgres for profiles, meals, reactions, taste profiles and lookup caches; **Neon Auth** for sign-in; the **agent's memory** (Mastra's storage lives in Neon) |
| **Bright Data** | Web Unlocker fetches Open Food Facts lookups, product labels from brand/retailer sites, and **restaurant menus + Google ratings** for nearby places and menu links (data for good: allergen info that's public but scattered) |
| **Mastra** | Gee's check-in agent: tool calls (likely-irritant analysis), structured triage, emergency detection, and memory threads per check-in |
| **Vultr** | Hosts the live demo (Ubuntu 24.04 · Node 22 · PM2 · Nginx · Let's Encrypt HTTPS) |

---

## Tech stack

- **Next.js 16** (App Router, Turbopack) · **React 19** · **TypeScript**
- **Neon Postgres** (`@neondatabase/serverless`) · **Neon Auth** (`@neon/auth`)
- **Gemini** (`@google/genai`) · **Mastra** (`@mastra/core`, `@mastra/memory`, `@mastra/pg`)
- **ElevenLabs** REST APIs · **Bright Data** Web Unlocker · **Open Food Facts** · **OpenStreetMap** (Overpass + Nominatim) · **Leaflet**
- Design ported from our Figma Make prototype (hand-drawn icons, Gee mascots)

## Project structure

```
app/
  AllerGeezApp.tsx     main app: home, record meal, reactions, Talk to Gee, Food Checker
  Emergency.tsx        voice-guided emergency guide, Gee chat, inactivity alarm
  FoodRadar.tsx        Food Near Me map, Restaurant Scanner, recommendations popup
  ProfileScreen.tsx    sign-in / sign-up, emergency contact
  api/
    scan/              Gemini: read a photo or description
    nutrition/         packaged-food lookup (Bright Data → Open Food Facts → web label)
    nearby/            places in 1/5/10 mile rings (+ /menu: rating, menu, ranked dishes)
    menu-check/        menu link or photo → dishes ranked for you
    gee/chat/          Mastra agent check-in (+ conversation memory)
    gee/sos/           Gemini replies in the emergency guide
    speak/ transcribe/ ElevenLabs text-to-speech / speech-to-text
    meals/ reactions/ profile/ taste/ allergens/   data APIs
lib/
  gee/agent.ts, gee/memory.ts   Mastra agent + Neon-backed memory
  irritants.ts                  likely-irritant algorithm
  taste.ts                      taste profile + dish matching (allergens, diet, hidden ingredients)
  allergens.ts, additives.ts, ingredients.ts, symptoms.ts
  nearby.ts, menus.ts, webproduct.ts, nutrition.ts   location + menu + label data
  session.ts, guest.ts          signed-in user or private guest profile
deploy/
  setup.sh, update.sh           one-command Vultr deploy
schema.sql                      database tables
```

---

## Run it locally

Requirements: **Node 22+**, a Neon database, and API keys for Gemini and ElevenLabs. Bright Data and Neon Auth are optional.

```bash
git clone https://github.com/preethiamara/allergeez.git
cd allergeez
cp .env.example .env.local      # fill in your keys
psql "$DATABASE_URL" -f schema.sql
npm install
npm run dev                     # http://localhost:3000
```

To try the camera and microphone on your phone over Wi-Fi, run `npm run dev:https` and open the `https://<your-computer-ip>:3000` address it prints.

### Environment variables

| Name | Required | What it's for |
|---|---|---|
| `GEMINI_API_KEY` | yes | Food, label and menu reading; Gee |
| `ELEVENLABS_API_KEY` | yes | Gee's voice and speech-to-text |
| `ELEVENLABS_VOICE_ID` | no | Gee's voice (default: Sarah) |
| `DATABASE_URL` | yes | Neon Postgres connection string |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | for sign-in | Neon Auth |
| `BRIGHTDATA_API_KEY`, `BRIGHTDATA_ZONE` | no | Restaurant menus, ratings, web labels (falls back to direct Open Food Facts) |
| `GEMINI_MODEL` | no | Force a specific Gemini model |

All keys are used **only on the server** (API routes). Nothing is exposed to the browser, and `.env.local` is never committed.

---

## Deploy to Vultr

1. Create a **Cloud Compute (Shared CPU)** server with **Ubuntu 24.04** and **2 GB RAM**.
2. On the server (`ssh root@YOUR_IP`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/preethiamara/allergeez/main/deploy/setup.sh | bash
   ```
   This installs Node 22, PM2, Nginx and a firewall, and gets a free HTTPS certificate on `YOUR-IP-WITH-DASHES.sslip.io` (or set `DOMAIN=yourdomain.com`).
3. From your computer, send your keys (they never go through GitHub):
   ```bash
   scp .env.local root@YOUR_IP:/var/www/allergeez/.env.local
   ```
4. On the server: `bash /var/www/allergeez/deploy/update.sh`. Run the same command to redeploy later.
5. In Neon, add your site's address as a **trusted domain** for Neon Auth so sign-in works.

---

## Privacy & safety

- **Health data stays in your database**: meals, reactions and Gee conversations live in your Neon Postgres. Voice clips are transcribed and discarded; no audio is stored by the app.
- **Private guest profiles**: signed-out visitors never see each other's data.
- **Safety rules for Gee**: never discourage epinephrine or 911, never diagnose, never suggest medicine other than your own epinephrine. The most urgent phrases are handled on the device, so they work even if an AI service is slow.
- Allergen info from menus and web pages is an **estimate**. Always tell your server about your allergy and read the label.

---


