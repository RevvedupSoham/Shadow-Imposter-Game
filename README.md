# SHADOW IMPOSTOR

A mobile-friendly social deduction game. Players receive secret words, give clues, discuss, vote, and try to identify the impostor.

## Stack

- React 19, TypeScript, Vite
- Supabase Edge Function for server-authoritative game actions
- Supabase Postgres for room state, chat, votes, rate limiting, and guest statistics
- Supabase Realtime broadcast invalidations with polling fallback
- GitHub Actions for tests and production builds

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Supabase project you have configured.
4. Run `npm install`, then `npm run dev`.
5. Run `npm test` and `npm run build` before deploying.

Only the publishable/anon client key belongs in frontend environment variables. Never put a Supabase service-role or secret key in this repository or a `VITE_*` variable.

## Backend setup

The frontend expects a deployed Supabase Edge Function named `game` and its database RPCs/migrations. The project used during development is `fzwmowoxvmngimkdmags` in Mumbai. If you use another Supabase project, apply the SQL migrations from the maintained backend source and deploy the `game` Edge Function with the service-role secret configured in Supabase Function secrets. Do not expose that secret to browsers.

Dashboard: https://supabase.com/dashboard/project/fzwmowoxvmngimkdmags

## Game rules

- 4–8 players per room.
- One impostor at 4–5 players; two impostors at 6–8.
- Crew members receive the shared secret word; impostors receive a decoy.
- Players submit clues, discuss, vote, and the impostor may get a final secret-word guess.
- Room state is validated on the backend; the browser is not the authority for game outcomes.

## CI

The workflow in `.github/workflows/ci.yml` runs `npm test` and `npm run build` on pushes to `main` and on pull requests.

## Current status

The frontend now has the API client and screens for creating/joining rooms, lobby, clues, voting, final guess, results, player list, chat, and personal stats. This repository's CI must pass and the configured Supabase function/database must be reachable before calling the deployed game production-ready.
