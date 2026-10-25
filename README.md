<img src="assets/icon.svg" width="64" height="64" alt="">

# Meld

Pinochle with your friends, in the browser, in real time. Type a name, deal a table, hand out a
six-letter code, pick your seats (or offer to swap), and play four-hand partnership pinochle to 150.
No account needed; guests can add an email later to keep history and friends. Short a player? The host
can seat computer players that bid, pass, meld and play from the same information a human sees.
New to the game? `/practice` walks you through a hand against three computers. Playing a trick a day
with far-flung friends? Deal a table at a leisurely pace and the "This hand so far" recap keeps everyone
caught up. How they
think is written up in [docs/COMPUTER_PLAYERS.md](docs/COMPUTER_PLAYERS.md).

Built with Next.js on Vercel and Supabase (Postgres, Auth, Realtime). Both run on their free tiers.

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md). Dev tools for reproducing any game state: [docs/DEV_TOOLS.md](docs/DEV_TOOLS.md).

## Set up once

1. **Supabase.** Create a free project at supabase.com. In the SQL editor, paste and run
   `supabase/migrations/0001_init.sql`. Under Authentication → Providers turn on Email (magic link)
   and, optionally, Google. Under Authentication → URL configuration add
   `https://<your-vercel-domain>/auth/callback` and `http://localhost:3000/auth/callback` as redirect URLs.
   Full detail in `supabase/README.md`.
2. **Vercel.** Import this GitHub repo. Add these environment variables (Project → Settings → Environment Variables):

   | Name | Where to find it |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project settings → API → Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project settings → API → anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API → service_role key (keep secret) |
   | `CRON_SECRET` | any long random string; Vercel sends it to the daily keep-alive cron |

   Deploy. The daily cron in `vercel.json` pings the database so the free Supabase project never pauses.

## Run locally

```bash
cp .env.example .env.local   # fill in the four values above
pnpm install
pnpm dev
```

`/dev/game` is a local-only preview of the game board driven by the rules engine with three automated seats.

## Layout

| Path | What lives there |
| --- | --- |
| `src/engine/` | Pure, tested pinochle rules: dealing, bidding, trump, passing, meld scoring, trick play, scoring. |
| `src/server/` | Server-side table, seat, trade, friend and game logic. Only the server ever sees full hands. |
| `src/app/api/` | JSON route handlers the client calls. |
| `src/components/` | The cards, the table, the scorepad, the lobby. |
| `supabase/` | Schema, row-level security, setup notes. |
| `src/engine/ai/` | Computer players. They only ever receive a `PlayerView`, never the full game state. |
| `docs/ARCHITECTURE.md` | How the pieces fit, and how a second card game slots in. |
| `docs/COMPUTER_PLAYERS.md` | How the computer players bid, pass and play, and how they are kept honest. |

## Rules (defaults, adjustable per table)

Four players, two partnerships, 48-card deck. Modern scoring is the default: minimum bid 25 in steps of 1, play to 150. Bidder names trump;
partner passes four cards to the bidder, who passes four back. Meld: run 15, royal marriage 4,
marriage 2, pinochle 4, double pinochle 30, aces around 10, kings 8, queens 6, jacks 4, dix 1.
Counters are aces, tens and kings at 1 each, plus 1 for the last trick. A side must take a trick to
keep its meld. Fail your bid and you go set for the bid amount. Classic ×10 scoring remains a
table option, with minimum bid 250 and target 1,500. Old-style 11 / 10 / 4 / 3 / 2 counting requires
classic scoring. Existing games keep their classic scale.

## License

[MIT](LICENSE). Copyright 2026 Andreas Wenzel.
