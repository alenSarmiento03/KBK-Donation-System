create table if not exists public.kbk_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    username text not null,
    role text not null check (role = 'admin'),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.kbk_profiles drop constraint if exists kbk_profiles_role_check;
with active_profile_count as (
    select count(*) as total from public.kbk_profiles where active
)
update public.kbk_profiles
set role = 'admin',
    active = case when kbk_profiles.active and active_profile_count.total = 1 then true else false end
from active_profile_count
where kbk_profiles.role = 'staff';
alter table public.kbk_profiles
    add constraint kbk_profiles_role_check check (role = 'admin');

create table if not exists public.kbk_app_data (
    data_key text primary key,
    data jsonb not null,
    revision integer not null default 1,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);

create index if not exists kbk_app_data_updated_by_idx
    on public.kbk_app_data (updated_by);

alter table public.kbk_profiles enable row level security;
alter table public.kbk_app_data enable row level security;

drop policy if exists "Users can read their own KBK profile" on public.kbk_profiles;
create policy "Users can read their own KBK profile"
    on public.kbk_profiles for select
    to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Active KBK users can read shared app data" on public.kbk_app_data;
drop policy if exists "Active KBK admins can read shared app data" on public.kbk_app_data;
create policy "Active KBK admins can read shared app data"
    on public.kbk_app_data for select
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "KBK admins can insert shared app data" on public.kbk_app_data;
create policy "KBK admins can insert shared app data"
    on public.kbk_app_data for insert
    to authenticated
    with check (
        updated_by = (select auth.uid())
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "KBK admins can update shared app data" on public.kbk_app_data;
create policy "KBK admins can update shared app data"
    on public.kbk_app_data for update
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    )
    with check (
        updated_by = (select auth.uid())
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "KBK admins can delete shared app data" on public.kbk_app_data;
create policy "KBK admins can delete shared app data"
    on public.kbk_app_data for delete
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

create or replace function public.kbk_public_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    donations jsonb;
    projects jsonb;
    beneficiaries jsonb;
    distributions jsonb;
    expenses jsonb;
    inventory jsonb;
    public_donor_count integer;
    public_beneficiary_count integer;
begin
    select data into donations from public.kbk_app_data where data_key = 'kbk_donations';
    select data into projects from public.kbk_app_data where data_key = 'kbk_projects';
    select data into beneficiaries from public.kbk_app_data where data_key = 'kbk_beneficiaries';
    select data into distributions from public.kbk_app_data where data_key = 'kbk_distributions';
    select data into expenses from public.kbk_app_data where data_key = 'kbk_expenses';
    select data into inventory from public.kbk_app_data where data_key = 'kbk_inventory';

    select count(distinct lower(trim(d ->> 'donor'))) into public_donor_count
    from jsonb_array_elements(coalesce(donations, '[]'::jsonb)) d
    where lower(coalesce(d ->> 'status', '')) in ('verified', 'allocated', 'distributed', 'completed')
      and nullif(trim(coalesce(d ->> 'donor', '')), '') is not null;

    with helped_beneficiaries as (
        select b ->> 'id' as beneficiary_id
        from jsonb_array_elements(coalesce(beneficiaries, '[]'::jsonb)) b
        where jsonb_array_length(coalesce(b -> 'assistance', '[]'::jsonb)) > 0
        union
        select d ->> 'beneficiaryId' as beneficiary_id
        from jsonb_array_elements(coalesce(distributions, '[]'::jsonb)) d
        where lower(coalesce(d ->> 'status', '')) in ('distributed', 'completed')
          and nullif(d ->> 'beneficiaryId', '') is not null
    )
    select count(*) into public_beneficiary_count
    from helped_beneficiaries
    where nullif(beneficiary_id, '') is not null;

    return jsonb_build_object(
        'kbk_donations',
        coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', d -> 'id',
                    'donor',
                    case
                        when coalesce((d ->> 'publicRecognition')::boolean, false)
                             and not coalesce((d ->> 'anonymous')::boolean, false)
                             and length(trim(coalesce(d ->> 'donor', ''))) > 0
                        then split_part(trim(d ->> 'donor'), ' ', 1) || ' ' ||
                             upper(left(split_part(trim(d ->> 'donor'), ' ',
                                 array_length(string_to_array(trim(d ->> 'donor'), ' '), 1)), 1)) || '.'
                        else 'Anonymous Donor'
                    end,
                    'publicRecognition', coalesce((d ->> 'publicRecognition')::boolean, false),
                    'anonymous', coalesce((d ->> 'anonymous')::boolean, true),
                    'type', d -> 'type',
                    'amount', d -> 'amount',
                    'item', d -> 'item',
                    'quantity', d -> 'quantity',
                    'unit', d -> 'unit',
                    'category', d -> 'category',
                    'date', d -> 'date',
                    'status', d -> 'status',
                    'projectId', d -> 'projectId',
                    'allocations',
                    coalesce((
                        select jsonb_agg(jsonb_build_object(
                            'purpose', a ->> 'purpose',
                            'amount', a -> 'amount',
                            'date', a ->> 'date'
                        ))
                        from jsonb_array_elements(coalesce(d -> 'allocations', '[]'::jsonb)) a
                    ), '[]'::jsonb)
                )
            )
            from jsonb_array_elements(coalesce(donations, '[]'::jsonb)) d
            where lower(coalesce(d ->> 'status', '')) in ('verified', 'allocated', 'distributed', 'completed')
        ), '[]'::jsonb),
        'kbk_projects',
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', p -> 'id',
                'name', p -> 'name',
                'budget', p -> 'budget',
                'description', p -> 'description',
                'status', p -> 'status'
            ))
            from jsonb_array_elements(coalesce(projects, '[]'::jsonb)) p
        ), '[]'::jsonb),
        'kbk_beneficiaries', '[]'::jsonb,
        'kbk_distributions',
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', d -> 'id',
                'projectId', d -> 'projectId',
                'category', d -> 'category',
                'itemAmount', d -> 'itemAmount',
                'quantity', d -> 'quantity',
                'date', d -> 'date',
                'confirmed', d -> 'confirmed',
                'status', d -> 'status'
            ))
            from jsonb_array_elements(coalesce(distributions, '[]'::jsonb)) d
            where lower(coalesce(d ->> 'status', '')) in ('distributed', 'completed')
        ), '[]'::jsonb),
        'kbk_expenses',
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'projectId', e -> 'projectId',
                'amount', e -> 'amount',
                'verified', true,
                'date', e ->> 'date'
            ))
            from jsonb_array_elements(coalesce(expenses, '[]'::jsonb)) e
            where coalesce((e ->> 'verified')::boolean, false)
        ), '[]'::jsonb),
        'kbk_inventory',
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', i -> 'id',
                'name', i -> 'name',
                'category', i -> 'category',
                'quantity', i -> 'quantity',
                'unit', i -> 'unit',
                'targetQuantity', i -> 'targetQuantity',
                'urgent', i -> 'urgent',
                'showPublicNeed', i -> 'showPublicNeed'
            ))
            from jsonb_array_elements(coalesce(inventory, '[]'::jsonb)) i
            where coalesce((i ->> 'showPublicNeed')::boolean, false)
        ), '[]'::jsonb),
        'kbk_public_metadata', jsonb_build_object(
            'uniqueDonors', coalesce(public_donor_count, 0),
            'beneficiariesHelped', coalesce(public_beneficiary_count, 0)
        )
    );
end;
$$;

revoke all on function public.kbk_public_snapshot() from public;
grant execute on function public.kbk_public_snapshot() to anon, authenticated;
grant select, insert, update, delete on public.kbk_app_data to authenticated;
grant select on public.kbk_profiles to authenticated;

-- Supabase may install this event-trigger helper in an existing project. It
-- must remain callable by the database event trigger, not the Data API roles.
do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
    end if;
end;
$$;

create table if not exists public.kbk_assistance_requests (
    id bigint generated by default as identity primary key,
    requester_name text,
    contact text not null,
    assistance_type text not null check (assistance_type in ('Food', 'Education', 'Medical', 'Emergency', 'Other')),
    quantity text,
    description text not null,
    status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
    submitted_at timestamptz not null default now(),
    reviewed_at timestamptz,
    constraint kbk_assistance_request_name_length
        check (requester_name is null or char_length(requester_name) <= 120),
    constraint kbk_assistance_request_contact_length
        check (char_length(btrim(contact)) between 7 and 160),
    constraint kbk_assistance_request_contact_format
        check (
            btrim(contact) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
            or (
                btrim(contact) ~ '^\+?[0-9 ().-]{7,20}$'
                and char_length(regexp_replace(contact, '[^0-9]', '', 'g')) between 7 and 15
            )
        ),
    constraint kbk_assistance_request_quantity_length
        check (quantity is null or char_length(quantity) <= 120),
    constraint kbk_assistance_request_description_length
        check (char_length(btrim(description)) between 10 and 1500)
);

alter table public.kbk_assistance_requests enable row level security;

revoke all on public.kbk_assistance_requests from anon, authenticated;
revoke insert (requester_name, contact, assistance_type, quantity, description)
    on public.kbk_assistance_requests from anon, authenticated;
grant select, delete on public.kbk_assistance_requests to authenticated;
grant update (requester_name, contact, assistance_type, quantity, description, status, reviewed_at)
    on public.kbk_assistance_requests to authenticated;
revoke usage, select on sequence public.kbk_assistance_requests_id_seq from anon, authenticated;

drop policy if exists "Public can submit assistance requests" on public.kbk_assistance_requests;
create policy "Public can submit assistance requests"
    on public.kbk_assistance_requests for insert
    to anon, authenticated
    with check (status = 'Pending' and reviewed_at is null);

drop policy if exists "Active KBK admins can read assistance requests" on public.kbk_assistance_requests;
create policy "Active KBK admins can read assistance requests"
    on public.kbk_assistance_requests for select
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can update assistance requests" on public.kbk_assistance_requests;
create policy "Active KBK admins can update assistance requests"
    on public.kbk_assistance_requests for update
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can delete assistance requests" on public.kbk_assistance_requests;
create policy "Active KBK admins can delete assistance requests"
    on public.kbk_assistance_requests for delete
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

comment on table public.kbk_assistance_requests is
    'Private public-submitted assistance requests. Only active KBK admins may read or manage requester details.';

create table if not exists public.kbk_public_feedback_messages (
    id bigint generated by default as identity primary key,
    requester_name text,
    contact text not null,
    subject text not null,
    message text not null,
    status text not null default 'New' check (status in ('New', 'Reviewed')),
    submitted_at timestamptz not null default now(),
    constraint kbk_feedback_name_length
        check (requester_name is null or char_length(requester_name) <= 120),
    constraint kbk_feedback_contact_length
        check (char_length(btrim(contact)) between 7 and 160),
    constraint kbk_feedback_contact_format
        check (
            btrim(contact) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
            or (
                btrim(contact) ~ '^\+?[0-9 ().-]{7,20}$'
                and char_length(regexp_replace(contact, '[^0-9]', '', 'g')) between 7 and 15
            )
        ),
    constraint kbk_feedback_subject_length
        check (char_length(btrim(subject)) between 1 and 160),
    constraint kbk_feedback_message_length
        check (char_length(btrim(message)) between 10 and 2000)
);

alter table public.kbk_public_feedback_messages enable row level security;

alter table public.kbk_public_feedback_messages
    drop constraint if exists kbk_public_feedback_messages_status_check;
update public.kbk_public_feedback_messages
set status = case when status = 'Reviewed' then 'Replied' else 'New' end
where status not in ('New', 'Replied', 'Resolved');
alter table public.kbk_public_feedback_messages
    add constraint kbk_public_feedback_messages_status_check
    check (status in ('New', 'Replied', 'Resolved'));

revoke all on public.kbk_public_feedback_messages from anon, authenticated;
revoke insert (requester_name, contact, subject, message)
    on public.kbk_public_feedback_messages from anon, authenticated;
grant select, delete on public.kbk_public_feedback_messages to authenticated;
grant update (status) on public.kbk_public_feedback_messages to authenticated;
revoke usage, select on sequence public.kbk_public_feedback_messages_id_seq from anon, authenticated;

drop policy if exists "Public can send contact messages" on public.kbk_public_feedback_messages;
create policy "Public can send contact messages"
    on public.kbk_public_feedback_messages for insert
    to anon, authenticated
    with check (status = 'New');

drop policy if exists "Active KBK admins can read contact messages" on public.kbk_public_feedback_messages;
create policy "Active KBK admins can read contact messages"
    on public.kbk_public_feedback_messages for select
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can update contact messages" on public.kbk_public_feedback_messages;
create policy "Active KBK admins can update contact messages"
    on public.kbk_public_feedback_messages for update
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    )
    with check (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can delete contact messages" on public.kbk_public_feedback_messages;
create policy "Active KBK admins can delete contact messages"
    on public.kbk_public_feedback_messages for delete
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

comment on table public.kbk_public_feedback_messages is
    'Private public-submitted contact messages. Only active KBK admins may read or manage submissions.';

-- Public submissions must pass Cloudflare Turnstile and server-side rate checks
-- in the public-submit Edge Function. Direct browser/API inserts stay revoked.
create table if not exists public.kbk_submission_rate_limits (
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    submission_type text not null check (submission_type in ('assistance', 'feedback')),
    window_started_at timestamptz not null,
    attempts integer not null default 1 check (attempts > 0),
    primary key (fingerprint, submission_type)
);
alter table public.kbk_submission_rate_limits enable row level security;
revoke all on public.kbk_submission_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.kbk_submission_rate_limits to service_role;

create or replace function public.kbk_consume_submission_limit(
    p_fingerprint text,
    p_submission_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_window timestamptz;
    current_attempts integer;
begin
    if p_fingerprint is null or p_submission_type is null
       or p_fingerprint !~ '^[0-9a-f]{64}$'
       or p_submission_type not in ('assistance', 'feedback') then
        return false;
    end if;

    current_window := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
    insert into public.kbk_submission_rate_limits (
        fingerprint, submission_type, window_started_at, attempts
    ) values (p_fingerprint, p_submission_type, current_window, 1)
    on conflict (fingerprint, submission_type) do update
    set window_started_at = case
            when public.kbk_submission_rate_limits.window_started_at <> excluded.window_started_at
                then excluded.window_started_at
            else public.kbk_submission_rate_limits.window_started_at
        end,
        attempts = case
            when public.kbk_submission_rate_limits.window_started_at <> excluded.window_started_at
                then 1
            else public.kbk_submission_rate_limits.attempts + 1
        end
    returning attempts into current_attempts;

    return current_attempts <= 10;
end;
$$;
revoke all on function public.kbk_consume_submission_limit(text, text) from public, anon, authenticated;
grant execute on function public.kbk_consume_submission_limit(text, text) to service_role;

create or replace function public.kbk_purge_expired_inbox()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.kbk_assistance_requests
    where submitted_at < now() - interval '180 days';
    delete from public.kbk_public_feedback_messages
    where submitted_at < now() - interval '180 days';
    delete from public.kbk_submission_rate_limits
    where window_started_at < now() - interval '2 days';
end;
$$;
revoke all on function public.kbk_purge_expired_inbox() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid)
from cron.job
where jobname = 'kbk-inbox-retention-180-days';
select cron.schedule(
    'kbk-inbox-retention-180-days',
    '13 3 * * *',
    'select public.kbk_purge_expired_inbox();'
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'kbk-donation-receipts',
    'KBK Donation Receipts',
    false,
    524288,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active KBK admins can read donation receipts" on storage.objects;
create policy "Active KBK admins can read donation receipts"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'kbk-donation-receipts'
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can upload donation receipts" on storage.objects;
create policy "Active KBK admins can upload donation receipts"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'kbk-donation-receipts'
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can delete donation receipts" on storage.objects;
create policy "Active KBK admins can delete donation receipts"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'kbk-donation-receipts'
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

-- Public evidence uses a separate bucket and table. Never make the private receipt bucket public.
create table if not exists public.kbk_public_transparency_evidence (
    id bigint generated by default as identity primary key,
    title text not null check (length(trim(title)) between 1 and 120),
    description text check (description is null or length(description) <= 240),
    document_date date,
    storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
    created_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now()
);

alter table public.kbk_public_transparency_evidence enable row level security;
drop policy if exists "Anyone can view published KBK transparency documents" on public.kbk_public_transparency_evidence;
create policy "Anyone can view published KBK transparency documents"
    on public.kbk_public_transparency_evidence for select
    to anon, authenticated
    using (true);

drop policy if exists "Active KBK admins can publish transparency documents" on public.kbk_public_transparency_evidence;
create policy "Active KBK admins can publish transparency documents"
    on public.kbk_public_transparency_evidence for insert
    to authenticated
    with check (
        created_by = (select auth.uid())
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can remove transparency documents" on public.kbk_public_transparency_evidence;
create policy "Active KBK admins can remove transparency documents"
    on public.kbk_public_transparency_evidence for delete
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

grant select on public.kbk_public_transparency_evidence to anon, authenticated;
grant insert, delete on public.kbk_public_transparency_evidence to authenticated;
grant usage, select on sequence public.kbk_public_transparency_evidence_id_seq to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'kbk-public-transparency',
    'KBK Public Transparency Documents',
    true,
    5242880,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active KBK admins can upload public transparency documents" on storage.objects;
create policy "Active KBK admins can upload public transparency documents"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'kbk-public-transparency'
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );

drop policy if exists "Active KBK admins can delete public transparency documents" on storage.objects;
create policy "Active KBK admins can delete public transparency documents"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'kbk-public-transparency'
        and exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active and p.role = 'admin'
        )
    );
