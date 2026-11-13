-- T1.9AM: «Synlig i nærheten» – a cheaper alternative to the area alert. The case is shown for
-- 7 days in «I nærheten» for people whose alert area covers the place, without push. The price
-- depends on how many people follow the area (three tiers). It is stored as an area-alert
-- campaign of kind VISIBILITY, so the nearby list, the case view for others and «sett/funnet»
-- work as for area alerts. Area-alert rules (one live, two per case) do not count these.
-- Repeatable: every step can run again without changing the result.

-- 1. Campaign kind.
alter table public.geo_alert_campaigns add column if not exists kind text not null default 'ALERT';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'geo_alert_campaigns_kind_check') then
    alter table public.geo_alert_campaigns
      add constraint geo_alert_campaigns_kind_check check (kind in ('ALERT', 'VISIBILITY'));
  end if;
end
$$;

-- 2. Products. TEST prices until the test panel has answered; must match nothing in the app
--    (the app shows the price the server quotes). Rows that already exist keep their price.
insert into public.product_catalog (code, name_no, name_en, product_type, billing_period, duration_count, base_price_ore, currency, active, metadata)
values
  ('AREA_VISIBILITY_TIER_1', 'Synlig i nærheten, under 500 personer', 'Visible nearby, under 500 people', 'ONE_TIME', 'DAY', 7, 3900, 'NOK', true,
    '{"kind": "AREA_VISIBILITY", "tier": 1, "followers_max": 499, "test_price": true}'::jsonb),
  ('AREA_VISIBILITY_TIER_2', 'Synlig i nærheten, 500–2000 personer', 'Visible nearby, 500–2000 people', 'ONE_TIME', 'DAY', 7, 6900, 'NOK', true,
    '{"kind": "AREA_VISIBILITY", "tier": 2, "followers_max": 2000, "test_price": true}'::jsonb),
  ('AREA_VISIBILITY_TIER_3', 'Synlig i nærheten, over 2000 personer', 'Visible nearby, over 2000 people', 'ONE_TIME', 'DAY', 7, 9900, 'NOK', true,
    '{"kind": "AREA_VISIBILITY", "tier": 3, "test_price": true}'::jsonb)
on conflict (code) do nothing;

-- Store product ids (same id in App Store Connect, Google Play and RevenueCat, consumable).
update public.product_catalog c
   set apple_product_id = v.store_id,
       google_product_id = v.store_id,
       updated_at = now()
  from (values
    ('AREA_VISIBILITY_TIER_1', 'lof_visible_nearby_1'),
    ('AREA_VISIBILITY_TIER_2', 'lof_visible_nearby_2'),
    ('AREA_VISIBILITY_TIER_3', 'lof_visible_nearby_3')
  ) as v(code, store_id)
 where c.code = v.code
   and (c.apple_product_id is distinct from v.store_id or c.google_product_id is distinct from v.store_id);

-- 3. The in-app notice says which kind it is (title AREA_ALERT or AREA_VISIBILITY); the app shows
--    «Varslet» only on area alerts. Same function otherwise.
create or replace function public.geo_alert_create_in_app_notifications(p_campaign_id uuid)
returns table(eligible_users integer, created_notifications integer)
language sql
security definer
set search_path = public, extensions
as $$
  with eligible as (
    select * from public.geo_alert_eligible_users(p_campaign_id)
  ),
  campaign as (
    select coalesce(c.kind, 'ALERT') as kind from public.geo_alert_campaigns c where c.id = p_campaign_id
  ),
  inserted as (
    insert into public.notifications
      (user_id, type, entity_type, entity_id, title, body, notification_key, agg_count)
    select e.recipient_user_id,
           'AREA_ALERT',
           'area_alert_campaign',
           e.campaign_id,
           case when (select kind from campaign) = 'VISIBILITY' then 'AREA_VISIBILITY' else 'AREA_ALERT' end,
           coalesce(e.report_title, 'AREA_ALERT'),
           'AREA_ALERT:' || e.campaign_id::text || ':' || e.recipient_user_id::text,
           1
    from eligible e
    on conflict (notification_key) where notification_key is not null do nothing
    returning 1
  )
  select (select count(*) from eligible)::integer,
         (select count(*) from inserted)::integer;
$$;

revoke all on function public.geo_alert_create_in_app_notifications(uuid) from public, anon, authenticated;
grant execute on function public.geo_alert_create_in_app_notifications(uuid) to service_role;
