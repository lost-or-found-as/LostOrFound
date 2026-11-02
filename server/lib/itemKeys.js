"use strict";
// T1.9U: item keys that were merged or removed in the reviewed item list, mapped to the item that
// replaced them. Older app builds can still send them; the server stores the current key.
// The same map lives in src/i18n/catalog.ts (LEGACY_ITEM_KEYS) and in the database function
// public.canonical_item_key; scripts/test-t1-9u.js checks that all three agree.
const LEGACY_ITEM_KEYS = Object.freeze({
  KEYCHAIN: "KEYS", HOUSE_KEY: "KEYS", MEDICATION_CASE: "MEDICATION",
  CONTACT_LENS_CASE: "OTHER_PERSONAL", PERFUME: "OTHER_PERSONAL", NAME_BADGE: "OTHER_PERSONAL",
  SPORT_WATCH: "SMARTWATCH", CHARGING_CABLE: "CHARGER", USB_DRIVE: "MEMORY_CARD",
  GPS_DEVICE: "OTHER_ELECTRONICS", PHONE_CASE: "OTHER_ELECTRONICS",
  DRONE_CONTROLLER: "DRONE_ACCESSORY", DRONE_BATTERY: "DRONE_ACCESSORY",
  CABIN_SUITCASE: "SUITCASE", TRAVEL_LUGGAGE: "SUITCASE", SPORTS_BAG: "GYM_BAG", TOTE_BAG: "SHOPPING_BAG",
  FLEECE: "FLEECE_JACKET", TOP: "T_SHIRT", TIE: "OTHER_CLOTHING",
  SIGNET_RING: "RING", ANKLET: "OTHER_JEWELRY", CUFFLINKS: "OTHER_JEWELRY", JEWELRY_BOX: "OTHER_JEWELRY",
  DRILL: "POWER_TOOL", MULTIMETER: "MEASURING_TOOL", LASER_TOOL: "MEASURING_TOOL", SAFETY_GLASSES: "OTHER_TOOLS",
  DISC_GOLF_DRIVER: "DISC_GOLF_DISC", DISC_GOLF_MIDRANGE: "DISC_GOLF_DISC", DISC_GOLF_PUTTER: "DISC_GOLF_DISC",
  FOOTBALL: "BALL", HANDBALL: "BALL", BASKETBALL: "BALL", VOLLEYBALL: "BALL", COMPASS: "OTHER_SPORT",
  DIARY: "NOTEBOOK", BOARD_GAME: "OTHER_HOBBY", PLAYING_CARDS: "OTHER_HOBBY",
  CHILD_WATER_BOTTLE: "WATER_BOTTLE", CHILD_BACKPACK: "SCHOOL_BAG",
  GUINEA_PIG: "SMALL_PET", HAMSTER: "SMALL_PET", TURTLE: "REPTILE",
  PET_COLLAR: "PET_GEAR", PET_LEASH: "PET_GEAR", PET_HARNESS: "PET_GEAR",
});

/** Stored form of an item key: upper case, and the current key for an older one. Empty -> null. */
function canonicalItemKey(value) {
  if (value == null) return null;
  const key = String(value).trim().toUpperCase();
  if (!key) return null;
  return LEGACY_ITEM_KEYS[key] || key;
}

module.exports = { LEGACY_ITEM_KEYS, canonicalItemKey };
