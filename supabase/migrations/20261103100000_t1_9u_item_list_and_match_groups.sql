-- T1.9U: reviewed item list and match groups.
-- Repeatable: functions are replaced, updates only touch rows that still hold an older key,
-- and the colour constraint is dropped and created with the same name.
--
-- 1. canonical_item_key: older item keys map to the item that replaced them. The same map lives in
--    src/i18n/catalog.ts (LEGACY_ITEM_KEYS) and server/lib/itemKeys.js; scripts/test-t1-9u.js
--    checks that all three agree.
create or replace function public.canonical_item_key(k text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case upper(nullif(btrim(k), ''))
    when 'KEYCHAIN' then 'KEYS'
    when 'HOUSE_KEY' then 'KEYS'
    when 'MEDICATION_CASE' then 'MEDICATION'
    when 'CONTACT_LENS_CASE' then 'OTHER_PERSONAL'
    when 'PERFUME' then 'OTHER_PERSONAL'
    when 'NAME_BADGE' then 'OTHER_PERSONAL'
    when 'SPORT_WATCH' then 'SMARTWATCH'
    when 'CHARGING_CABLE' then 'CHARGER'
    when 'USB_DRIVE' then 'MEMORY_CARD'
    when 'GPS_DEVICE' then 'OTHER_ELECTRONICS'
    when 'PHONE_CASE' then 'OTHER_ELECTRONICS'
    when 'DRONE_CONTROLLER' then 'DRONE_ACCESSORY'
    when 'DRONE_BATTERY' then 'DRONE_ACCESSORY'
    when 'CABIN_SUITCASE' then 'SUITCASE'
    when 'TRAVEL_LUGGAGE' then 'SUITCASE'
    when 'SPORTS_BAG' then 'GYM_BAG'
    when 'TOTE_BAG' then 'SHOPPING_BAG'
    when 'FLEECE' then 'FLEECE_JACKET'
    when 'TOP' then 'T_SHIRT'
    when 'TIE' then 'OTHER_CLOTHING'
    when 'SIGNET_RING' then 'RING'
    when 'ANKLET' then 'OTHER_JEWELRY'
    when 'CUFFLINKS' then 'OTHER_JEWELRY'
    when 'JEWELRY_BOX' then 'OTHER_JEWELRY'
    when 'DRILL' then 'POWER_TOOL'
    when 'MULTIMETER' then 'MEASURING_TOOL'
    when 'LASER_TOOL' then 'MEASURING_TOOL'
    when 'SAFETY_GLASSES' then 'OTHER_TOOLS'
    when 'DISC_GOLF_DRIVER' then 'DISC_GOLF_DISC'
    when 'DISC_GOLF_MIDRANGE' then 'DISC_GOLF_DISC'
    when 'DISC_GOLF_PUTTER' then 'DISC_GOLF_DISC'
    when 'FOOTBALL' then 'BALL'
    when 'HANDBALL' then 'BALL'
    when 'BASKETBALL' then 'BALL'
    when 'VOLLEYBALL' then 'BALL'
    when 'COMPASS' then 'OTHER_SPORT'
    when 'DIARY' then 'NOTEBOOK'
    when 'BOARD_GAME' then 'OTHER_HOBBY'
    when 'PLAYING_CARDS' then 'OTHER_HOBBY'
    when 'CHILD_WATER_BOTTLE' then 'WATER_BOTTLE'
    when 'CHILD_BACKPACK' then 'SCHOOL_BAG'
    when 'GUINEA_PIG' then 'SMALL_PET'
    when 'HAMSTER' then 'SMALL_PET'
    when 'TURTLE' then 'REPTILE'
    when 'PET_COLLAR' then 'PET_GEAR'
    when 'PET_LEASH' then 'PET_GEAR'
    when 'PET_HARNESS' then 'PET_GEAR'
    else upper(nullif(btrim(k), ''))
  end;
$$;

-- 2. Match groups. Same item = 3, near (often confused) = 2, related = 1, otherwise no match.
--    Groups agreed in the item review (Lost_or_Found_Gjenstandsliste_gjennomgang_v1.xlsx).
create or replace function public.object_compatibility_level(a text, b text)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  with k as (select public.canonical_item_key(a) as a, public.canonical_item_key(b) as b)
  select case
    when k.a is null or k.b is null then 1
    when k.a = k.b then 3
    when k.a like 'OTHER%' or k.b like 'OTHER%' or k.a = 'CUSTOM' or k.b = 'CUSTOM' then 1
    else coalesce((
      select max(g.level)
      from (values
        -- near (2)
        (2, array['RING','WEDDING_RING','ENGAGEMENT_RING']),
        (2, array['WATCH','SMARTWATCH','FITNESS_TRACKER','HEART_RATE_MONITOR','SMART_RING']),
        (2, array['HEADPHONES','EARBUDS','SINGLE_EARBUD','CHARGING_CASE']),
        (2, array['SWEATER','HOODIE','CARDIGAN','FLEECE_JACKET']),
        (2, array['JACKET','RAIN_JACKET','DOWN_JACKET','FLEECE_JACKET','BLAZER']),
        (2, array['CAMERA','ACTION_CAMERA']),
        (2, array['BACKPACK','HIKING_BACKPACK','SCHOOL_BAG']),
        (2, array['GYM_BAG','TRAVEL_BAG']),
        (2, array['HANDBAG','SHOULDER_BAG','WAIST_BAG']),
        (2, array['BICYCLE','E_BIKE']),
        (2, array['SCOOTER','E_SCOOTER']),
        (2, array['ACCESS_CARD','ACCESS_TAG','CHARGING_TAG']),
        (2, array['NECKLACE','PENDANT']),
        (2, array['MUSICAL_INSTRUMENT','GUITAR','VIOLIN','INSTRUMENT_CASE']),
        (2, array['WATER_BOTTLE','THERMOS']),
        (2, array['SCARF','NECK_GAITER']),
        (2, array['STROLLER','STROLLER_FOOTMUFF']),
        (2, array['WALLET','CARD_HOLDER']),
        -- related (1)
        (1, array['KEYS','CAR_KEYS']),
        (1, array['RING','SMART_RING']),
        (1, array['HELMET','BIKE_HELMET','MOTORCYCLE_HELMET']),
        (1, array['SWEATER','HOODIE','CARDIGAN','FLEECE_JACKET','JACKET','VEST']),
        (1, array['JACKET','RAIN_JACKET','DOWN_JACKET','FLEECE_JACKET','BLAZER','VEST','KIDS_RAINWEAR']),
        (1, array['SHOES','SNEAKERS','BOOTS','SANDALS']),
        (1, array['TENNIS_RACKET','PADEL_RACKET','BADMINTON_RACKET']),
        (1, array['HAT','CAP','BRIMMED_HAT','HEADBAND']),
        (1, array['TOY','STUFFED_TOY','DOLL','RC_VEHICLE']),
        (1, array['GYM_BAG','TRAVEL_BAG','SUITCASE','TOILETRY_BAG']),
        (1, array['WATER_BOTTLE','THERMOS','BABY_BOTTLE'])
      ) as g(level, items)
      where k.a = any(g.items) and k.b = any(g.items)
    ), 0)
  end
  from k;
$$;

-- 3. Existing reports move to the current keys. Updating subcategory_key and the colours runs the
--    match refresh trigger, so these reports are matched again with the new groups.
update public.reports
   set subcategory_key = public.canonical_item_key(subcategory_key)
 where subcategory_key is not null
   and public.canonical_item_key(subcategory_key) is distinct from subcategory_key
   and upper(btrim(subcategory_key)) in (
     'KEYCHAIN','HOUSE_KEY','MEDICATION_CASE','CONTACT_LENS_CASE','PERFUME','NAME_BADGE',
     'SPORT_WATCH','CHARGING_CABLE','USB_DRIVE','GPS_DEVICE','PHONE_CASE','DRONE_CONTROLLER','DRONE_BATTERY',
     'CABIN_SUITCASE','TRAVEL_LUGGAGE','SPORTS_BAG','TOTE_BAG','FLEECE','TOP','TIE',
     'SIGNET_RING','ANKLET','CUFFLINKS','JEWELRY_BOX','DRILL','MULTIMETER','LASER_TOOL','SAFETY_GLASSES',
     'DISC_GOLF_DRIVER','DISC_GOLF_MIDRANGE','DISC_GOLF_PUTTER','FOOTBALL','HANDBALL','BASKETBALL','VOLLEYBALL',
     'COMPASS','DIARY','BOARD_GAME','PLAYING_CARDS','CHILD_WATER_BOTTLE','CHILD_BACKPACK',
     'GUINEA_PIG','HAMSTER','TURTLE','PET_COLLAR','PET_LEASH','PET_HARNESS'
   );

-- 4. Colours: lime, cyan and magenta were folded into green, turquoise and pink.
update public.reports
   set color = case lower(color) when 'lime' then 'green' when 'cyan' then 'turquoise' when 'magenta' then 'pink' end
 where lower(color) in ('lime', 'cyan', 'magenta');

update public.reports
   set secondary_color = case lower(secondary_color) when 'lime' then 'green' when 'cyan' then 'turquoise' when 'magenta' then 'pink' end
 where lower(secondary_color) in ('lime', 'cyan', 'magenta');

alter table public.reports drop constraint if exists reports_secondary_color_key;
alter table public.reports add constraint reports_secondary_color_key check (
  secondary_color is null or secondary_color in (
    'black','white','gray','red','orange','yellow','green','blue','purple','brown','pink',
    'beige','navy','light-blue','turquoise','burgundy','olive',
    'gold','silver','bronze','camo','multicolor','patterned','unknown','other'
  )
);
