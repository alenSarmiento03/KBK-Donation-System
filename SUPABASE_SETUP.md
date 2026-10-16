# Supabase setup

This project is a static browser app. Supabase provides shared PostgreSQL storage and authentication; the browser must use only the project's publishable/anon key. Never put a service-role or secret key in this app.

## Configure the project

1. Create a Supabase project, then create `supabase-config.js` in the repository root with this content:

   ```js
   window.KBK_SUPABASE_CONFIG = {
       url: 'https://YOUR_PROJECT_ID.supabase.co',
       anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
       turnstileSiteKey: 'YOUR_CLOUDFLARE_TURNSTILE_SITE_KEY'
   };
   ```

2. Replace the URL, publishable/anon key, and Turnstile site key. Use the Supabase project root URL only; do not add `/rest/v1/`. The Supabase publishable key and Turnstile site key are public values. Never put a Supabase secret/service-role key or the Turnstile secret key in this file.
3. In Cloudflare Turnstile, create a widget for the website's deployed hostname and copy its **site key** into `turnstileSiteKey`. Keep its **secret key** for the Supabase Edge Function secret in step 5.
4. In Supabase Edge Function Secrets, set `TURNSTILE_SECRET_KEY` and `KBK_TURNSTILE_HOSTNAMES` (comma-separated allowed hostnames, such as `example.org,www.example.org`). Never put the secret key in the website config or send it in chat.
5. Deploy the Edge Functions from this repository. Install the Supabase CLI, then run these commands from the project folder (replace the project ref if needed):

   ```powershell
   supabase login
   supabase link --project-ref iqyfignomjnlqixrnyjb
   supabase functions deploy public-submit
   supabase functions deploy notify-inbox
   ```

   The supplied `supabase/config.toml` disables automatic JWT checking for these endpoints. The public submission function verifies Turnstile itself, and the inbox notifier checks its webhook secret.
6. In Supabase SQL Editor, run `supabase-setup.sql`. If this project was already set up, run the updated file again. It removes direct anonymous insert access to inbox tables, creates the private rate-limit data, schedules daily deletion of inbox records older than 180 days, and creates the private receipt and public transparency document buckets with their policies. Verify that the `kbk-inbox-retention-180-days` job is active under Supabase Dashboard > Integrations > Cron.
7. In Authentication, create your one administrator account with a strong password. Copy that user's UUID, then run:

   ```sql
   insert into public.kbk_profiles (user_id, username, role, active)
   values ('AUTH_USER_UUID', 'admin', 'admin', true);
   ```

8. Do not create additional KBK accounts. The system supports administrator profiles only; assign the `admin` role only through trusted Supabase administration, never from the browser.
9. Deploy the repository to Vercel. Ensure `supabase-config.js` is included in the deployed Git commit; Vercel environment variables do not automatically populate a static JavaScript config file. After changing the config, commit and push the file to trigger a deployment. Configure Supabase Auth's allowed redirect URLs to include your deployed domain. Public submissions are available only after the Turnstile key, Edge Function secrets and deployment, and SQL setup are all complete.

## Data and privacy

Only an active administrator can access or change shared records. The updated setup SQL removes the staff role. If there is exactly one active profile and it is currently staff, the SQL promotes that profile to admin; otherwise, existing staff profiles are deactivated. It does not delete Supabase Authentication accounts. Disable or delete any unused sign-in accounts separately in Supabase Authentication. Unauthenticated public pages call `kbk_public_snapshot()`, which excludes pending/rejected donations, receipts, donor contact details, beneficiary names, and private inventory locations. Donor names are reduced to first name and last initial only when public recognition was explicitly granted.

The legacy browser demo accounts and their plaintext passwords are removed; they are not migrated. On the first authenticated admin visit, old shared-list values are backed up in browser storage under `kbk_legacy_backup_*`, while the remote lists are loaded separately. Use **Import this browser's saved records** on Users & Accounts only after reviewing the backup; importing replaces matching shared lists and may include old sample data. New assistance requests are stored in `kbk_assistance_requests`, and contact form messages in `kbk_public_feedback_messages`. The public can submit through the Turnstile-protected Edge Function but cannot read submissions or insert directly into the tables. Active admins can read and manage inbox records in the Requests page. Messages can be marked New, Replied, or Resolved; reply links open the administrator's email or messaging app and do not send automatically. Older assistance requests and contact messages saved in a browser are not automatically migrated; review them on the browser where they were submitted before clearing its data.

### New-message email notifications

Full submissions remain in the private Supabase inbox. Optional email notifications alert the administrator without including requester contact information or message contents.

1. Create and verify a sender domain/address in Resend.
2. In Supabase Edge Function Secrets, set `RESEND_API_KEY`, `KBK_NOTIFICATION_EMAIL` (the admin notification recipient), `KBK_NOTIFICATION_FROM` (the verified sender, such as `KBK Inbox <inbox@your-verified-domain>`), and `KBK_WEBHOOK_SECRET` (a long random value). Optionally set `KBK_INBOX_URL` to the deployed admin Requests page. Never place these values in website files or chat.
3. In Supabase Database Webhooks, create INSERT webhooks for `public.kbk_assistance_requests` and `public.kbk_public_feedback_messages`, both targeting `notify-inbox`. Add the HTTP header `x-kbk-webhook-secret` with the same `KBK_WEBHOOK_SECRET` value.

Notifications are best-effort alerts; Supabase remains the source of truth. Check Edge Function and Resend logs if alerts fail. Until the sender, secrets, and webhooks are configured, submissions still appear in the admin inbox, but no email notification is sent.

On an authenticated administrator visit, the app adds the active **Community Food Pack Campaign** project with a ₱30,000 target if it does not already exist. The one-time check avoids creating duplicates and makes the campaign available in project-linked forms and public campaign progress.

The assistance form is intended for authorized representatives of Lipa City LGUs only. It collects the LGU office or department, an official contact method, assistance type, and a short description; quantity is optional. Both public forms require a Cloudflare Turnstile token verified by the `public-submit` Edge Function; direct browser inserts are revoked. The function limits each IP address to 10 submissions per form type per UTC hour and fails closed if it cannot verify Turnstile or obtain an IP address for rate limiting. Rate-limit fingerprints are SHA-256 hashes, not stored IP addresses. Supabase Cron runs `kbk_purge_expired_inbox()` daily and removes assistance requests and contact messages older than 180 days. Confirm the job is active in Supabase Dashboard > Integrations > Cron after applying the setup SQL. Never expose a service-role/secret key in this static app.

Uploaded donation and expense proof is stored in the private `kbk-donation-receipts` Supabase Storage bucket, not embedded in shared records. Only active administrators can upload, download, or delete proof files; each file is limited to 512 KB and PDF, JPEG, PNG, or WebP. Expense receipts are stored under separate `expenses/` paths and can be uploaded, viewed, or replaced from Expense Management. On Donation Tracking, **Create KBK receipt** opens a branded donation acknowledgment that can be printed or saved as PDF; **Download uploaded proof** retrieves the original supporting file separately. The acknowledgment is a system record, not a tax invoice or government receipt. For public transparency, admins can publish separately reviewed and redacted copies from the Transparency page. Those files are public to anyone with a link, so remove personal and transaction details first. They use the separate `kbk-public-transparency` bucket; never change the original receipt bucket to public. The buckets, evidence table, and policies are created by `supabase-setup.sql`. After applying the updated setup SQL and deploying the app, open Donation Tracking as an administrator and use **Move old receipts to private storage** to migrate existing embedded proof. The app keeps old records unchanged if an upload fails; if the shared save times out, refresh before retrying so records that may already have been migrated are reloaded from Supabase.

Shared data is cached locally and synchronized per record list. Concurrent edits to the same list are protected by revision checks; a conflicting save is reported and must be reviewed/reloaded instead of silently overwriting another administrator's update.

Donation records link to donor profiles by stable donor ID. When migrating older records, the app links only exact donor-name matches with exactly one matching profile; ambiguous and unmatched records remain available by their saved donor name for manual review.

Enable email confirmation if appropriate for the organization. Use a strong unique password for each administrator, and configure Supabase backups/retention for the project's plan.
