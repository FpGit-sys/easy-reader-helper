\set ON_ERROR_STOP on

insert into public.software_licenses (
  id, key_hash, status, valid_until, offline_grace_days, max_installations
) values (
  '10000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'active',
  now() + interval '1 month',
  7,
  2
);

select public.activate_software_license(
  repeat('a', 64),
  '20000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  'CI local'
);

select public.refresh_software_license(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  repeat('b', 64)
);

insert into public.software_licenses (
  id, key_hash, status
) values (
  '30000000-0000-4000-8000-000000000001',
  repeat('c', 64),
  'available'
);

select public.process_asaas_payment_event(
  'evt_ci_1',
  'PAYMENT_RECEIVED',
  'pay_ci_1',
  'sub_ci_1',
  'silonr-license:30000000-0000-4000-8000-000000000001',
  repeat('d', 64)
);

create temporary table first_validity as
select valid_until from public.software_licenses
where id = '30000000-0000-4000-8000-000000000001';

select public.process_asaas_payment_event(
  'evt_ci_1',
  'PAYMENT_RECEIVED',
  'pay_ci_1',
  'sub_ci_1',
  'silonr-license:30000000-0000-4000-8000-000000000001',
  repeat('d', 64)
);

do $$
declare
  v_license public.software_licenses%rowtype;
  v_first timestamptz;
  v_events integer;
begin
  select * into v_license from public.software_licenses
  where id = '30000000-0000-4000-8000-000000000001';
  select valid_until into v_first from first_validity;
  select count(*) into v_events from public.payment_webhook_events
  where provider_event_id = 'evt_ci_1';
  if v_license.status <> 'active' then raise exception 'expected active license'; end if;
  if v_license.valid_until <> v_first then raise exception 'duplicate event extended validity'; end if;
  if v_events <> 1 then raise exception 'duplicate event was stored twice'; end if;
end;
$$;
