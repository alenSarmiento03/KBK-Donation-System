create table if not exists public.kbk_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    username text not null,
    role text not null check (role in ('admin', 'staff')),
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.kbk_app_data (
    data_key text primary key,
    data jsonb not null,
    revision integer not null default 1,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);

alter table public.kbk_profiles enable row level security;
alter table public.kbk_app_data enable row level security;

drop policy if exists "Users can read their own KBK profile" on public.kbk_profiles;
create policy "Users can read their own KBK profile"
    on public.kbk_profiles for select
    to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "Active KBK users can read shared app data" on public.kbk_app_data;
create policy "Active KBK users can read shared app data"
    on public.kbk_app_data for select
    to authenticated
    using (
        exists (
            select 1 from public.kbk_profiles p
            where p.user_id = (select auth.uid()) and p.active
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
grant insert (requester_name, contact, assistance_type, quantity, description)
    on public.kbk_assistance_requests to anon, authenticated;
grant select, delete on public.kbk_assistance_requests to authenticated;
grant update (requester_name, contact, assistance_type, quantity, description, status, reviewed_at)
    on public.kbk_assistance_requests to authenticated;
grant usage on sequence public.kbk_assistance_requests_id_seq to anon, authenticated;

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
