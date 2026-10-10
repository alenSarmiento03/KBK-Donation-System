# Supabase setup

This project is a static browser app. Supabase provides shared PostgreSQL storage and authentication; the browser must use only the project's publishable/anon key. Never put a service-role or secret key in this app.

## Configure the project

1. Create a Supabase project and copy `supabase-config.example.js` to `supabase-config.js`.
2. Put the Project URL (for example, `https://YOUR_PROJECT_ID.supabase.co`) and the project's publishable/anon key into `supabase-config.js`. Use the project root URL only; do not add `/rest/v1/`. This static browser app serves that file publicly, as required for the Supabase client. The publishable/anon key is designed for public use; never put a secret or service-role key in this file. Database security must be enforced by Supabase Row Level Security policies.
3. In Supabase SQL Editor, run `supabase-setup.sql`. If this project was already set up, run the updated file again to create the private shared assistance-request inbox and its row-level security policies.
4. In Authentication, create the first user with the intended administrator email and a strong password. Copy that user's UUID, then run:

   ```sql
   insert into public.kbk_profiles (user_id, username, role, active)
   values ('AUTH_USER_UUID', 'admin', 'admin', true);
   ```

5. Create each additional user in Supabase Authentication, then add their profile with role `staff` or `admin`. Roles are assigned only through trusted Supabase administration, never from the browser.
6. Deploy the repository to Vercel. Ensure `supabase-config.js` is included in the deployed Git commit; Vercel environment variables do not automatically populate a static JavaScript config file. After changing the config, commit and push the file to trigger a deployment. Configure Supabase Auth's allowed redirect URLs to include your deployed domain.

## Data and privacy

Admin users read shared records; only active admins can write them. Staff profiles are read-only. Unauthenticated public pages call `kbk_public_snapshot()`, which excludes pending/rejected donations, receipts, donor contact details, beneficiary names, and private inventory locations. Donor names are reduced to first name and last initial only when public recognition was explicitly granted.

The legacy browser demo accounts and their plaintext passwords are removed; they are not migrated. On the first authenticated admin visit, old shared-list values are backed up in browser storage under `kbk_legacy_backup_*`, while the remote lists are loaded separately. Use **Import this browser's saved records** on Users & Accounts only after reviewing the backup; importing replaces matching shared lists and may include old sample data. New assistance requests are stored in `kbk_assistance_requests`: the public can submit but cannot read submissions, while only active admins can read, update, or delete them. Contact form messages are stored in `kbk_public_feedback_messages`: the public can submit but cannot read messages, while active admins can read, mark reviewed, or delete them in the Requests inbox. Submissions are stored in the shared inbox but do not trigger email notifications; admins must check the inbox. Older assistance requests and contact messages saved in a browser are not automatically migrated; review them on the browser where they were submitted before clearing its data.

The assistance form deliberately collects only a contact method, assistance type, and short description (name and quantity are optional). Admins must review and delete resolved requests when no longer needed; no automatic retention or deletion schedule is configured. The anonymous insert policy does not provide bot protection or rate limiting. Before public production use, add server-side abuse prevention (for example, a CAPTCHA verified by a Supabase Edge Function with secrets stored server-side) and define an approved retention schedule. Never expose a service-role key in this static app.

The donation form no longer accepts or displays receipt uploads. Existing receipt data already embedded in older donation records is left untouched; review and approve a separate cleanup before removing any historical records.

Shared data is cached locally and synchronized per record list. Concurrent edits to the same list are protected by revision checks; a conflicting save is reported and must be reviewed/reloaded instead of silently overwriting another administrator's update.

Donation records link to donor profiles by stable donor ID. When migrating older records, the app links only exact donor-name matches with exactly one matching profile; ambiguous and unmatched records remain available by their saved donor name for manual review.

Enable email confirmation if appropriate for the organization. Use a strong unique password for each administrator, and configure Supabase backups/retention for the project's plan.
