# Supabase setup

1. Create a free Supabase project at https://supabase.com/dashboard. Save the database password and wait for provisioning.
2. Open SQL Editor, create a query, run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_default_rules.sql`, once each in order. For a linked project, `supabase db push` applies both migrations. Run this before creating Auth users so the profile trigger handles every signup. No local Supabase configuration is required.
3. Under Authentication > Sign In / Providers, enable Email and magic link sign-in. Enable Google, enter the Google OAuth client ID and secret, and add the Supabase callback URL shown there to the Google client's authorized redirect URIs. Supabase's default email sender has delivery limits; configure custom SMTP for general use.
4. Under Authentication > URL Configuration, set Site URL to the canonical production origin, `https://YOUR_DOMAIN`. Add `https://YOUR_DOMAIN/auth/callback` and `http://localhost:3000/auth/callback` to Redirect URLs. Also allow `https://YOUR_DOMAIN/auth/callback?next=**` for the app's destination query, with equivalent entries for supported localhost and preview origins. Without the query entry, Supabase rejects the requested callback and falls back to Site URL. The frontend passes `${location.origin}/auth/callback?next=...` as `emailRedirectTo` for magic links and `redirectTo` for Google OAuth. The supplied callback route exchanges the PKCE code for session cookies and validates the destination.
5. Copy `.env.example` to `.env.local`. From Project Settings > API, copy the project URL, anon key, and service_role key into the corresponding variables. Generate `CRON_SECRET` with `openssl rand -hex 32`. Set all four variables in Vercel project Settings > Environment Variables for each deployed environment, then redeploy:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`

Keep the service role key and cron secret private. The browser only receives the two `NEXT_PUBLIC_` values. This implementation uses the requested legacy anon/service_role keys.

`vercel.json` schedules `/api/cron/keepalive` daily at 09:00 UTC. Vercel sends `Authorization: Bearer <CRON_SECRET>`. The route performs a small database select.

Table broadcasts carry invalidation events only. Full game state stays in service-only tables; each player retrieves their own view through the authenticated API. Broadcast and lobby presence channels use Supabase's default public channel mode. Presence is an unverified online hint and must never authorize a move. No database replication publication is needed.

Seat and trade RPCs and game commits run as transactions and are executable only by service_role. Routes validate the Auth user before calling them. Knowing a table code permits preview and joining; a game view still requires a seat. Friend requests return accepted, incoming, and outgoing lists with both profiles. Profiles use snake_case database field names; PATCH `/api/me` accepts `displayName` and `defaultRules`; handles are never typed, and POST `/api/me/handle` draws a random two-word one. `defaultRules` is a strict partial rules object stored in `profiles.default_rules`; sending `{}` clears the saved defaults.

Server APIs use the verified user ID as the last argument, except the specified `getView(code, userId)` and `act(code, userId, action)` signatures. `getTableSnapshot` returns `{ table, seats, offers, mySeat }`; seat entries contain `profile`, and `mySeat` is an index or null. The presence hook takes `{ userId, handle, tableCode }` or null and returns user-ID keys with arrays of sessions.

References: [Supabase server clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [server broadcast](https://supabase.com/docs/guides/realtime/broadcast).

## Guest play (required)

Meld lets people play without creating an account. In the Supabase dashboard go to
Authentication → Providers → Anonymous sign-ins and turn it on. Guests get a real session
tied to the browser; from the lobby they can add an email or link Google, which upgrades the
same user in place so their tables, history and friends carry over.

## Emails

Auth emails (magic link, signup confirmation, email change, password reset) use branded templates in `supabase/emails/`. To re-apply after editing them, with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in your environment:

    set -a; . ~/.config/meld/env; set +a
    node scripts/apply-email-templates.mjs

The script sets the subject and HTML for each template and prints the fields it changed.
Supabase's built-in sender is restricted to project team addresses and two messages per hour.
Custom SMTP permits other recipients, but Supabase and the email provider retain separate rate limits.

### Custom SMTP is required for the branded templates

Supabase refuses template changes on the free tier while the default email provider is in use
(`Email template modification is not available for free tier projects using the default email provider`).
Fix: configure custom SMTP, then run the apply script.

Meld uses Resend for outgoing authentication emails. The sender is
`Meld <meld@YOUR_DOMAIN>`. Configure a mailbox or forwarding destination separately
if replies should reach a support inbox.

1. Add the sending domain in Resend and publish its supplied DKIM, SPF, MX and CNAME records
   with the domain's DNS provider. Use the return-path subdomain supplied by Resend;
   preserve existing root-domain MX records when configuring outgoing mail. Receiving mail
   is a separate configuration.
2. Wait for Resend to report the domain verified. Keep open and click tracking disabled so
   authentication links are not rewritten.
3. Save `RESEND_API_KEY` and `MELD_EMAIL_FROM` in `~/.config/meld/env`, with mode 600.
   Configure Supabase Authentication > Email > SMTP Settings with:

   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
   - Sender email: `meld@YOUR_DOMAIN`
   - Sender name: `Meld`

4. Apply the branded templates:

```bash
set -a; . ~/.config/meld/env; set +a
node scripts/apply-email-templates.mjs
```

5. Request a magic link through the production sign-in form, completing Turnstile if prompted.
   Verify the From address, Meld branding and delivery in the recipient inbox. Separately send
   to the sender address from another account if incoming replies are configured.

Auth caches email subjects and bodies for ten minutes by default. A successful template API
update and read-back do not prove the next email has refreshed. After changing templates,
allow the cache to expire and inspect a fresh delivered email before calling the update verified.
See the [Auth template cache configuration](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go)
and [email-template troubleshooting](https://supabase.com/docs/guides/troubleshooting/email-template-not-updating).

Supabase's initial custom-SMTP limit is 30 messages per hour. Resend's account quota also applies;
changing providers does not remove Supabase's limits. Never print the full Auth config response,
which can contain credentials.

References: [Resend SMTP with Supabase](https://resend.com/docs/send-with-supabase-smtp),
[Supabase custom SMTP and rate limits](https://supabase.com/docs/guides/auth/auth-smtp),
[Cloudflare forwarding](https://developers.cloudflare.com/email-service/get-started/route-emails/).

### Captcha (Cloudflare Turnstile)

Guest sign-in and magic links pass a Turnstile token (`src/lib/captcha.tsx`). Create a Turnstile
widget allowed on your production domain, your `*.vercel.app` domain and `localhost`. Its site key
goes in `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel; the secret goes in Supabase under
Authentication > Attack Protection, with captcha on.

With captcha on, scripts that sign in directly (the `test-*.mjs` scripts) are rejected by
Supabase. Keep captcha enabled in production. `scripts/smoke.mjs` avoids sign-in: it creates
throwaway confirmed users with the service key, exchanges admin-generated magic-link tokens for
sessions, and deletes the users afterwards.
Locally, leaving the site key unset skips the widget but does not disable Supabase's check.
