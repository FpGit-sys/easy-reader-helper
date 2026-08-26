create extension if not exists pgcrypto;

create table if not exists public.software_licenses (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  plan text not null default 'professional',
  status text not null default 'available'
    check (status in ('available', 'trial', 'active', 'past_due', 'suspended', 'expired', 'cancelled')),
  customer_email text,
  organization_name text,
  valid_until timestamptz,
  offline_grace_days integer not null default 7 check (offline_grace_days between 0 and 30),
  max_facilities integer not null default 1 check (max_facilities > 0),
  max_users integer not null default 5 check (max_users > 0),
  max_installations integer not null default 3 check (max_installations > 0),
  provider text not null default 'asaas',
  external_subscription_id text,
  last_payment_id text,
  entitlement_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists software_licenses_provider_subscription_uidx
  on public.software_licenses (provider, external_subscription_id)
  where external_subscription_id is not null;

create table if not exists public.license_installations (
  id uuid primary key,
  license_id uuid not null references public.software_licenses(id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  label text not null default 'SiloNR local',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (license_id, id)
);

create index if not exists license_installations_license_idx
  on public.license_installations (license_id, last_seen_at desc);

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payment_id text,
  license_id uuid references public.software_licenses(id) on delete set null,
  payload_sha256 text not null,
  processed boolean not null default false,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

alter table public.software_licenses enable row level security;
alter table public.license_installations enable row level security;
alter table public.payment_webhook_events enable row level security;

revoke all on public.software_licenses from anon, authenticated;
revoke all on public.license_installations from anon, authenticated;
revoke all on public.payment_webhook_events from anon, authenticated;

create or replace function public.activate_software_license(
  p_key_hash text,
  p_installation_id uuid,
  p_secret_hash text,
  p_label text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license public.software_licenses%rowtype;
  v_existing public.license_installations%rowtype;
  v_count integer;
  v_grace_until timestamptz;
begin
  select * into v_license
  from public.software_licenses
  where key_hash = lower(p_key_hash)
  for update;

  if not found then raise exception 'LICENSE_KEY_INVALID'; end if;
  if v_license.status not in ('trial', 'active', 'past_due') then
    raise exception 'LICENSE_NOT_ACTIVE';
  end if;
  if v_license.valid_until is null then raise exception 'LICENSE_VALIDITY_MISSING'; end if;

  v_grace_until := v_license.valid_until + make_interval(days => v_license.offline_grace_days);
  if now() > v_grace_until then raise exception 'LICENSE_EXPIRED'; end if;

  if exists (
    select 1 from public.license_installations
    where id = p_installation_id and license_id <> v_license.id
  ) then
    raise exception 'INSTALLATION_ID_CONFLICT';
  end if;

  select * into v_existing
  from public.license_installations
  where id = p_installation_id and license_id = v_license.id
  for update;

  if found and v_existing.revoked_at is not null then
    raise exception 'INSTALLATION_REVOKED';
  end if;

  if not found then
    select count(*) into v_count
    from public.license_installations
    where license_id = v_license.id and revoked_at is null;
    if v_count >= v_license.max_installations then
      raise exception 'INSTALLATION_LIMIT_REACHED';
    end if;
  end if;

  insert into public.license_installations (id, license_id, secret_hash, label)
  values (p_installation_id, v_license.id, lower(p_secret_hash), left(coalesce(nullif(p_label, ''), 'SiloNR local'), 120))
  on conflict (id) do update set
    secret_hash = excluded.secret_hash,
    label = excluded.label,
    last_seen_at = now(),
    revoked_at = null;

  return jsonb_build_object(
    'licenseId', v_license.id,
    'installationId', p_installation_id,
    'plan', v_license.plan,
    'status', v_license.status,
    'validUntil', v_license.valid_until,
    'graceUntil', v_grace_until,
    'offlineGraceDays', v_license.offline_grace_days,
    'maxFacilities', v_license.max_facilities,
    'maxUsers', v_license.max_users,
    'maxInstallations', v_license.max_installations,
    'entitlementVersion', v_license.entitlement_version
  );
end;
$$;

create or replace function public.refresh_software_license(
  p_license_id uuid,
  p_installation_id uuid,
  p_secret_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license public.software_licenses%rowtype;
  v_installation public.license_installations%rowtype;
  v_grace_until timestamptz;
begin
  select * into v_installation
  from public.license_installations
  where id = p_installation_id
    and license_id = p_license_id
    and secret_hash = lower(p_secret_hash)
    and revoked_at is null
  for update;

  if not found then raise exception 'INSTALLATION_NOT_AUTHORIZED'; end if;

  select * into v_license
  from public.software_licenses
  where id = p_license_id;
  if not found then raise exception 'LICENSE_NOT_FOUND'; end if;

  update public.license_installations set last_seen_at = now() where id = p_installation_id;
  v_grace_until := coalesce(
    v_license.valid_until + make_interval(days => v_license.offline_grace_days),
    now()
  );

  return jsonb_build_object(
    'licenseId', v_license.id,
    'installationId', p_installation_id,
    'plan', v_license.plan,
    'status', v_license.status,
    'validUntil', v_license.valid_until,
    'graceUntil', v_grace_until,
    'offlineGraceDays', v_license.offline_grace_days,
    'maxFacilities', v_license.max_facilities,
    'maxUsers', v_license.max_users,
    'maxInstallations', v_license.max_installations,
    'entitlementVersion', v_license.entitlement_version
  );
end;
$$;

create or replace function public.process_asaas_payment_event(
  p_event_id text,
  p_event_type text,
  p_payment_id text,
  p_subscription_id text,
  p_external_reference text,
  p_payload_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_pk uuid;
  v_license public.software_licenses%rowtype;
  v_reference_id uuid;
  v_next_status text;
begin
  insert into public.payment_webhook_events (
    provider, provider_event_id, event_type, payment_id, payload_sha256
  ) values (
    'asaas', p_event_id, p_event_type, p_payment_id, lower(p_payload_sha256)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_event_pk;

  if v_event_pk is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if coalesce(p_external_reference, '') ~* '^silonr-license:[0-9a-f-]{36}$' then
    v_reference_id := split_part(p_external_reference, ':', 2)::uuid;
  elsif coalesce(p_external_reference, '') ~* '^[0-9a-f-]{36}$' then
    v_reference_id := p_external_reference::uuid;
  end if;

  select * into v_license
  from public.software_licenses
  where (v_reference_id is not null and id = v_reference_id)
     or (p_subscription_id is not null and provider = 'asaas' and external_subscription_id = p_subscription_id)
  order by case when id = v_reference_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    update public.payment_webhook_events
    set processing_error = 'LICENSE_MAPPING_NOT_FOUND', processed_at = now()
    where id = v_event_pk;
    return jsonb_build_object('duplicate', false, 'matched', false);
  end if;

  v_next_status := v_license.status;
  if p_event_type in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED') then
    v_next_status := 'active';
    update public.software_licenses set
      status = v_next_status,
      valid_until = case
        when last_payment_id = p_payment_id then valid_until
        else greatest(coalesce(valid_until, now()), now()) + interval '1 month'
      end,
      external_subscription_id = coalesce(external_subscription_id, p_subscription_id),
      last_payment_id = p_payment_id,
      entitlement_version = entitlement_version + 1,
      updated_at = now()
    where id = v_license.id;
  elsif p_event_type in ('PAYMENT_OVERDUE') then
    v_next_status := 'past_due';
    update public.software_licenses set
      status = case when coalesce(valid_until, now()) <= now() then 'past_due' else status end,
      external_subscription_id = coalesce(external_subscription_id, p_subscription_id),
      entitlement_version = entitlement_version + 1,
      updated_at = now()
    where id = v_license.id;
  elsif p_event_type in ('PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE', 'PAYMENT_DELETED') then
    v_next_status := 'suspended';
    update public.software_licenses set
      status = 'suspended', entitlement_version = entitlement_version + 1, updated_at = now()
    where id = v_license.id;
  end if;

  update public.payment_webhook_events set
    license_id = v_license.id,
    processed = true,
    processed_at = now()
  where id = v_event_pk;

  return jsonb_build_object('duplicate', false, 'matched', true, 'licenseId', v_license.id, 'status', v_next_status);
exception when others then
  if v_event_pk is not null then
    update public.payment_webhook_events
    set processing_error = left(sqlerrm, 500), processed_at = now()
    where id = v_event_pk;
  end if;
  raise;
end;
$$;

revoke all on function public.activate_software_license(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.refresh_software_license(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.process_asaas_payment_event(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.activate_software_license(text, uuid, text, text) to service_role;
grant execute on function public.refresh_software_license(uuid, uuid, text) to service_role;
grant execute on function public.process_asaas_payment_event(text, text, text, text, text, text) to service_role;
