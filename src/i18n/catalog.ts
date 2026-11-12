// src/i18n/catalog.ts
// T1.9E: the one place where category, item and colour names live, in every app language.
// Each entry has a stable key (stored in the database) and a name per language. When a new
// language is added to Lang, TypeScript requires a name for it in every entry, and
// scripts/test-t1-9e-catalog.js checks that no name is empty.
// Aliases are extra search words (any language, lower case) for the item search.
import type { Lang } from "./translate";

export type CatalogNames = { [L in Lang]: string };
export type CatalogEntry = { key: string; names: CatalogNames; aliases?: string[] };

export const CATEGORY_CATALOG: CatalogEntry[] = [
  { key: "PERSONAL", names: { no: "Personlige eiendeler", en: "Personal belongings", de: "Persönliche Gegenstände" } },
  { key: "ELECTRONICS", names: { no: "Elektronikk", en: "Electronics", de: "Elektronik" } },
  { key: "BAGS_LUGGAGE", names: { no: "Vesker og bagasje", en: "Bags and luggage", de: "Taschen und Gepäck" } },
  { key: "CLOTHING_ACCESSORIES", names: { no: "Klær og tilbehør", en: "Clothing and accessories", de: "Kleidung und Accessoires" } },
  { key: "JEWELRY", names: { no: "Smykker og klokker", en: "Jewelry and watches", de: "Schmuck und Uhren" } },
  { key: "TOOLS_HOUSE", names: { no: "Verktøy", en: "Tools", de: "Werkzeug" } },
  { key: "VEHICLE_TRANSPORT", names: { no: "Sykkel og kjøretøy", en: "Bikes and vehicles", de: "Fahrräder und Fahrzeuge" } },
  { key: "SPORT_OUTDOOR", names: { no: "Sport og friluft", en: "Sports and outdoors", de: "Sport und Outdoor" } },
  { key: "CULTURE_HOBBY", names: { no: "Skole, kultur og hobby", en: "School, culture and hobbies", de: "Schule, Kultur und Hobby" } },
  { key: "CHILDREN_FAMILY", names: { no: "Barn og familie", en: "Children and family", de: "Kinder und Familie" } },
  { key: "PETS", names: { no: "Husdyr", en: "Pets", de: "Haustiere" } },
];

// T1.9U: items that belong in more than one category are listed in each of them with the same
// entry (same key), so they match themselves whichever category the reporter picked. The first
// category in CATEGORY_CATALOG order is the item's home (used by search and lookups).
const SHARED = {
  CAR_KEYS: { key: "CAR_KEYS", names: { no: "Bilnøkler", en: "Car keys", de: "Autoschlüssel" }, aliases: ["bilnokkel", "bilnøkkel", "bilnøkler", "car key", "car keys", "carkey", "key fob"] },
  TOILETRY_BAG: { key: "TOILETRY_BAG", names: { no: "Toalettmappe", en: "Toiletry bag", de: "Kulturbeutel" }, aliases: ["toalettmappe", "toilettmappe", "sminkepung", "toiletry bag", "wash bag", "makeup bag"] },
  WALKIE_TALKIE: { key: "WALKIE_TALKIE", names: { no: "Walkie-talkie", en: "Walkie-talkie", de: "Funkgerät" }, aliases: ["walkie talkie", "radio", "two-way radio"] },
  HEART_RATE_MONITOR: { key: "HEART_RATE_MONITOR", names: { no: "Pulsmåler", en: "Heart rate monitor", de: "Pulsmesser" }, aliases: ["pulsmåler", "pulsbelte", "heart rate", "chest strap"] },
  SCHOOL_BAG: { key: "SCHOOL_BAG", names: { no: "Skolesekk / barnesekk", en: "School bag / kids' backpack", de: "Schultasche / Kinderrucksack" }, aliases: ["skolesekk", "barnesekk", "school bag", "kids backpack"] },
  BIKE_HELMET: { key: "BIKE_HELMET", names: { no: "Sykkelhjelm", en: "Bike helmet", de: "Fahrradhelm" }, aliases: ["sykkelhjelm", "bike helmet", "bicycle helmet"] },
  WATER_BOTTLE: { key: "WATER_BOTTLE", names: { no: "Drikkeflaske", en: "Water bottle", de: "Trinkflasche" }, aliases: ["drikkeflaske", "vannflaske", "flaske", "water bottle", "bottle"] },
  RC_VEHICLE: { key: "RC_VEHICLE", names: { no: "Fjernstyrt bil / leke", en: "Remote-controlled toy", de: "Ferngesteuertes Spielzeug" }, aliases: ["fjernstyrt", "radiostyrt", "rc bil", "rc car"] },
} satisfies Record<string, CatalogEntry>;

export const ITEM_CATALOG: Record<string, CatalogEntry[]> = {
  PERSONAL: [
    { key: "KEYS", names: { no: "Nøkler", en: "Keys", de: "Schlüssel" }, aliases: ["nøkler", "nokler", "keys", "key", "nokkel", "nøkkel", "nøkkelknippe", "nokkelknippe", "husnøkkel", "husnokkel", "keychain", "key ring", "house key"] },
    SHARED.CAR_KEYS,
    { key: "WALLET", names: { no: "Lommebok", en: "Wallet", de: "Geldbörse" }, aliases: ["lommebok", "wallet", "purse", "pung"] },
    { key: "CARD_HOLDER", names: { no: "Kortholder", en: "Card holder", de: "Kartenetui" }, aliases: ["kortholder", "kortetui", "card holder", "card case"] },
    { key: "CASH", names: { no: "Kontanter", en: "Cash", de: "Bargeld" }, aliases: ["kontanter", "penger", "sedler", "cash", "money"] },
    { key: "MOBILE_PHONE", names: { no: "Mobiltelefon", en: "Mobile phone", de: "Handy" }, aliases: ["mobil", "telefon", "iphone", "phone", "cellphone", "mobiltelefon", "mobile", "smartphone"] },
    { key: "SUNGLASSES", names: { no: "Solbriller", en: "Sunglasses", de: "Sonnenbrille" }, aliases: ["solbriller", "sunglasses", "sun glasses"] },
    { key: "GLASSES", names: { no: "Briller", en: "Glasses", de: "Brille" }, aliases: ["briller", "vanlige briller", "lesebriller", "glasses", "spectacles", "reading glasses"] },
    { key: "GLASSES_CASE", names: { no: "Brilleetui", en: "Glasses case", de: "Brillenetui" } },
    { key: "BANK_CARD", names: { no: "Bankkort", en: "Bank card", de: "Bankkarte" }, aliases: ["bankkort", "kredittkort", "visa", "mastercard", "bank card", "credit card", "debit card"] },
    { key: "ACCESS_CARD", names: { no: "Adgangskort", en: "Access card", de: "Zugangskarte" }, aliases: ["adgangskort", "nøkkelkort", "access card", "key card"] },
    { key: "ACCESS_TAG", names: { no: "Adgangsbrikke", en: "Access tag", de: "Zugangschip" }, aliases: ["adgangsbrikke", "nøkkelbrikke", "brikke", "access tag", "key fob"] },
    { key: "TRAVEL_CARD", names: { no: "Reisekort", en: "Travel card", de: "Fahrkarte / Verkehrskarte" } },
    { key: "STUDENT_CARD", names: { no: "Studentkort", en: "Student card", de: "Schüler- / Studentenausweis" } },
    { key: "ID_CARD", names: { no: "ID-kort", en: "ID card", de: "Ausweis" } },
    { key: "PASSPORT", names: { no: "Pass", en: "Passport", de: "Reisepass" } },
    { key: "DRIVER_LICENSE", names: { no: "Førerkort", en: "Driver's license", de: "Führerschein" }, aliases: ["førerkort", "sertifikat", "lappen", "driver's license", "driving licence"] },
    { key: "HEARING_AID", names: { no: "Høreapparat", en: "Hearing aid", de: "Hörgerät" } },
    { key: "MEDICATION", names: { no: "Medisiner / medisinboks", en: "Medication / pill box", de: "Medikamente / Pillendose" }, aliases: ["medisin", "medisiner", "medisinboks", "pilleboks", "medication", "pill box", "pills", "inhalator", "inhaler"] },
    { key: "RETAINER", names: { no: "Tannregulering / bittskinne", en: "Retainer / mouthguard", de: "Zahnspange / Mundschutz" }, aliases: ["tannregulering", "bittskinne", "tannskinne", "retainer", "mouthguard", "night guard"] },
    { key: "WALKING_AID", names: { no: "Ganghjelpemiddel (stokk, krykke, rullator)", en: "Walking aid (cane, crutch, walker)", de: "Gehhilfe (Stock, Krücke, Rollator)" }, aliases: ["stokk", "krykke", "rullator", "gåstol", "cane", "crutch", "walker", "walking stick"] },
    { key: "VAPE", names: { no: "E-sigarett / vape", en: "E-cigarette / vape", de: "E-Zigarette / Vape" }, aliases: ["e-sigarett", "esigarett", "vape", "e-cigarette"] },
    SHARED.TOILETRY_BAG,
    { key: "OTHER_PERSONAL", names: { no: "Annet (personlige)", en: "Other personal item", de: "Anderer persönlicher Gegenstand" } },
  ],
  ELECTRONICS: [
    { key: "HEADPHONES", names: { no: "Hodetelefoner (over øret)", en: "Headphones (over-ear)", de: "Kopfhörer (Over-Ear)" }, aliases: ["hodetelefoner", "headset", "headphones", "over-ear"] },
    { key: "EARBUDS", names: { no: "Trådløse ørepropper", en: "Wireless earbuds", de: "Kabellose Ohrhörer" }, aliases: ["airpods", "ørepropper", "orepropper", "earbuds", "earphones", "galaxy buds", "pixel buds"] },
    { key: "SINGLE_EARBUD", names: { no: "Enkelt ørepropp", en: "Single earbud", de: "Einzelner Ohrhörer" }, aliases: ["ørepropp", "en airpod", "single airpod", "single earbud", "one earbud"] },
    { key: "CHARGING_CASE", names: { no: "Ladeetui", en: "Charging case", de: "Ladeetui" }, aliases: ["ladeetui", "airpods etui", "charging case", "earbud case"] },
    { key: "SMARTWATCH", names: { no: "Smartklokke / sportsklokke", en: "Smartwatch / sports watch", de: "Smartwatch / Sportuhr" }, aliases: ["smartklokke", "sportsklokke", "apple watch", "galaxy watch", "garmin", "smartwatch", "sports watch"] },
    { key: "FITNESS_TRACKER", names: { no: "Aktivitetsarmbånd", en: "Fitness tracker", de: "Fitnesstracker" }, aliases: ["aktivitetsarmbånd", "fitbit", "fitness tracker", "fitness band"] },
    { key: "SMART_RING", names: { no: "Smartring", en: "Smart ring", de: "Smart Ring" }, aliases: ["smartring", "oura", "smart ring"] },
    SHARED.HEART_RATE_MONITOR,
    { key: "TABLET", names: { no: "Nettbrett", en: "Tablet", de: "Tablet" }, aliases: ["nettbrett", "ipad", "tablet"] },
    { key: "LAPTOP", names: { no: "Bærbar PC", en: "Laptop", de: "Laptop" }, aliases: ["bærbar", "pc", "macbook", "laptop", "notebook computer"] },
    { key: "E_READER", names: { no: "E-bokleser", en: "E-reader", de: "E-Reader" }, aliases: ["kindle", "lesebrett", "e-reader"] },
    { key: "POWERBANK", names: { no: "Powerbank", en: "Power bank", de: "Powerbank" } },
    { key: "CHARGER", names: { no: "Lader / ladekabel", en: "Charger / cable", de: "Ladegerät / Kabel" }, aliases: ["lader", "ladekabel", "kabel", "charger", "mobillader", "phone charger", "charging cable", "cable"] },
    { key: "CAMERA", names: { no: "Kamera", en: "Camera", de: "Kamera" } },
    { key: "ACTION_CAMERA", names: { no: "Actionkamera", en: "Action camera", de: "Actionkamera" }, aliases: ["gopro", "actionkamera", "action camera"] },
    { key: "CAMERA_LENS", names: { no: "Kameralinse", en: "Camera lens", de: "Kameraobjektiv" } },
    { key: "MEMORY_CARD", names: { no: "Minnekort / USB-minne", en: "Memory card / USB drive", de: "Speicherkarte / USB-Stick" }, aliases: ["minnekort", "sd-kort", "usb", "minnepinne", "memory card", "sd card", "usb drive", "usb stick"] },
    { key: "EXTERNAL_DRIVE", names: { no: "Ekstern harddisk", en: "External drive", de: "Externe Festplatte" } },
    { key: "SPEAKER", names: { no: "Høyttaler", en: "Speaker", de: "Lautsprecher" } },
    { key: "GAME_CONSOLE", names: { no: "Håndholdt spillkonsoll", en: "Handheld game console", de: "Handheld-Spielkonsole" }, aliases: ["spillkonsoll", "nintendo switch", "switch", "steam deck", "game console"] },
    { key: "GAME_CONTROLLER", names: { no: "Spillkontroller", en: "Game controller", de: "Gamecontroller" } },
    { key: "STYLUS", names: { no: "Elektronisk penn", en: "Stylus", de: "Eingabestift" }, aliases: ["apple pencil", "pekepenn", "stylus"] },
    { key: "TRACKER_TAG", names: { no: "Sporingsbrikke", en: "Tracker tag", de: "Tracker" }, aliases: ["airtag", "sporingsbrikke", "tracker tag", "smarttag", "tile"] },
    SHARED.WALKIE_TALKIE,
    { key: "DRONE", names: { no: "Drone", en: "Drone", de: "Drohne" }, aliases: ["drone", "quadrocopter", "quadcopter"] },
    { key: "DRONE_ACCESSORY", names: { no: "Droneutstyr (kontroller, batteri)", en: "Drone accessory (controller, battery)", de: "Drohnenzubehör (Fernbedienung, Akku)" }, aliases: ["dronekontroller", "fjernkontroll drone", "drone remote", "dronebatteri", "drone battery"] },
    { key: "OTHER_ELECTRONICS", names: { no: "Annet (elektronikk)", en: "Other electronics", de: "Andere Elektronik" } },
  ],
  BAGS_LUGGAGE: [
    { key: "BACKPACK", names: { no: "Ryggsekk", en: "Backpack", de: "Rucksack" }, aliases: ["ryggsekk", "sekk", "backpack", "rucksack"] },
    { key: "HANDBAG", names: { no: "Håndveske", en: "Handbag", de: "Handtasche" }, aliases: ["håndveske", "veske", "handbag", "purse"] },
    { key: "SHOULDER_BAG", names: { no: "Skulderveske", en: "Shoulder bag", de: "Umhängetasche" }, aliases: ["skulderveske", "crossbody", "shoulder bag"] },
    { key: "WAIST_BAG", names: { no: "Belteveske", en: "Waist bag", de: "Bauchtasche" }, aliases: ["belteveske", "rumpetaske", "magebelte", "bum bag", "fanny pack", "waist bag"] },
    { key: "SUITCASE", names: { no: "Koffert", en: "Suitcase", de: "Koffer" }, aliases: ["koffert", "kabinkoffert", "trillekoffert", "suitcase", "cabin bag", "luggage"] },
    { key: "TRAVEL_BAG", names: { no: "Reisebag", en: "Travel bag", de: "Reisetasche" }, aliases: ["reisebag", "duffel", "travel bag", "weekend bag"] },
    { key: "GYM_BAG", names: { no: "Treningsbag / sportsbag", en: "Gym bag / sports bag", de: "Sporttasche" }, aliases: ["treningsbag", "sportsbag", "gym bag", "sports bag"] },
    SHARED.SCHOOL_BAG,
    SHARED.TOILETRY_BAG,
    { key: "LAPTOP_BAG", names: { no: "PC-veske", en: "Laptop bag", de: "Laptoptasche" } },
    { key: "CAMERA_BAG", names: { no: "Kameraveske", en: "Camera bag", de: "Kameratasche" } },
    { key: "TOOL_BAG", names: { no: "Verktøybag", en: "Tool bag", de: "Werkzeugtasche" } },
    { key: "DOCUMENT_BRIEFCASE", names: { no: "Dokumentmappe", en: "Document case", de: "Dokumentenmappe" }, aliases: ["dokumentmappe", "mappe", "briefcase"] },
    { key: "SHOPPING_BAG", names: { no: "Handlepose / tøyveske", en: "Shopping bag / tote bag", de: "Einkaufstasche / Stoffbeutel" }, aliases: ["handlepose", "pose", "tøyveske", "tote", "shopping bag", "tote bag"] },
    { key: "OTHER_BAGS", names: { no: "Annet (veske/bagasje)", en: "Other bag/luggage", de: "Andere Tasche / anderes Gepäck" } },
  ],
  CLOTHING_ACCESSORIES: [
    { key: "JACKET", names: { no: "Jakke", en: "Jacket", de: "Jacke" }, aliases: ["jakke", "jacket", "coat", "kåpe", "frakk"] },
    { key: "RAIN_JACKET", names: { no: "Regnjakke", en: "Rain jacket", de: "Regenjacke" } },
    { key: "DOWN_JACKET", names: { no: "Dunjakke", en: "Down jacket", de: "Daunenjacke" } },
    { key: "FLEECE_JACKET", names: { no: "Fleece", en: "Fleece", de: "Fleecejacke" }, aliases: ["fleece", "fleecejakke", "fleecegenser", "fleece jacket"] },
    { key: "BLAZER", names: { no: "Blazer / dressjakke", en: "Blazer / suit jacket", de: "Blazer / Sakko" }, aliases: ["blazer", "dressjakke", "suit jacket"] },
    { key: "VEST", names: { no: "Vest", en: "Vest", de: "Weste" }, aliases: ["vest", "dunvest", "gilet"] },
    { key: "SWEATER", names: { no: "Genser", en: "Sweater", de: "Pullover" }, aliases: ["genser", "sweater", "jumper", "strikkegenser"] },
    { key: "HOODIE", names: { no: "Hettegenser", en: "Hoodie", de: "Kapuzenpullover" }, aliases: ["hettegenser", "hoodie", "hooded sweater"] },
    { key: "CARDIGAN", names: { no: "Cardigan", en: "Cardigan", de: "Strickjacke" }, aliases: ["cardigan", "strikkejakke"] },
    { key: "SHIRT", names: { no: "Skjorte", en: "Shirt", de: "Hemd" } },
    { key: "T_SHIRT", names: { no: "T-skjorte / topp", en: "T-shirt / top", de: "T-Shirt / Top" }, aliases: ["t-skjorte", "tskjorte", "topp", "t-shirt", "tshirt", "top"] },
    { key: "TROUSERS", names: { no: "Bukse", en: "Trousers", de: "Hose" }, aliases: ["bukse", "jeans", "trousers", "pants"] },
    { key: "SHORTS", names: { no: "Shorts", en: "Shorts", de: "Shorts" } },
    { key: "DRESS", names: { no: "Kjole", en: "Dress", de: "Kleid" } },
    { key: "SKIRT", names: { no: "Skjørt", en: "Skirt", de: "Rock" } },
    { key: "SWIMWEAR", names: { no: "Badetøy", en: "Swimwear", de: "Badebekleidung" }, aliases: ["badetøy", "badedrakt", "bikini", "badebukse", "swimwear", "swimsuit"] },
    { key: "HAT", names: { no: "Lue", en: "Beanie", de: "Mütze" }, aliases: ["lue", "beanie", "hat"] },
    { key: "HEADBAND", names: { no: "Pannebånd", en: "Headband", de: "Stirnband" }, aliases: ["pannebånd", "headband", "ear warmer"] },
    { key: "CAP", names: { no: "Caps", en: "Cap", de: "Kappe" }, aliases: ["caps", "cap", "baseball cap"] },
    { key: "BRIMMED_HAT", names: { no: "Hatt", en: "Hat", de: "Hut" } },
    { key: "GLOVES", names: { no: "Hansker / votter", en: "Gloves / mittens", de: "Handschuhe / Fäustlinge" }, aliases: ["hanske", "hansker", "vott", "votter", "glove", "gloves", "mittens"] },
    { key: "SCARF", names: { no: "Skjerf", en: "Scarf", de: "Schal" } },
    { key: "NECK_GAITER", names: { no: "Hals / buff", en: "Neck gaiter", de: "Halstuch / Schlauchschal" }, aliases: ["hals", "buff", "halsedisse", "neck gaiter", "neck warmer"] },
    { key: "BELT", names: { no: "Belte", en: "Belt", de: "Gürtel" } },
    { key: "SHOES", names: { no: "Sko", en: "Shoes", de: "Schuhe" } },
    { key: "SNEAKERS", names: { no: "Joggesko", en: "Sneakers", de: "Turnschuhe" } },
    { key: "BOOTS", names: { no: "Støvler", en: "Boots", de: "Stiefel" } },
    { key: "SANDALS", names: { no: "Sandaler", en: "Sandals", de: "Sandalen" } },
    { key: "UMBRELLA", names: { no: "Paraply", en: "Umbrella", de: "Regenschirm" } },
    { key: "REFLECTIVE_VEST", names: { no: "Refleks / refleksvest", en: "Reflector / reflective vest", de: "Reflektor / Warnweste" }, aliases: ["refleks", "refleksvest", "reflector", "reflective vest", "hi-vis"] },
    { key: "OTHER_CLOTHING", names: { no: "Annet (klær/tilbehør)", en: "Other clothing/accessory", de: "Andere Kleidung / anderes Accessoire" } },
  ],
  JEWELRY: [
    { key: "RING", names: { no: "Ring", en: "Ring", de: "Ring" }, aliases: ["ring", "signetring", "signet ring"] },
    { key: "WEDDING_RING", names: { no: "Giftering", en: "Wedding ring", de: "Ehering" }, aliases: ["giftering", "wedding ring", "wedding band"] },
    { key: "ENGAGEMENT_RING", names: { no: "Forlovelsesring", en: "Engagement ring", de: "Verlobungsring" }, aliases: ["forlovelsesring", "engagement ring"] },
    { key: "EARRINGS", names: { no: "Ørering / øredobber", en: "Earring(s)", de: "Ohrring(e)" }, aliases: ["ørering", "øredobb", "øredobber", "oredobber", "earrings", "earring", "stud"] },
    { key: "NECKLACE", names: { no: "Halskjede", en: "Necklace", de: "Halskette" }, aliases: ["halskjede", "kjede", "necklace", "chain"] },
    { key: "PENDANT", names: { no: "Anheng", en: "Pendant", de: "Anhänger" }, aliases: ["anheng", "medaljong", "pendant", "locket", "charm"] },
    { key: "BRACELET", names: { no: "Armbånd", en: "Bracelet", de: "Armband" }, aliases: ["armbånd", "armband", "bracelet"] },
    { key: "WATCH", names: { no: "Armbåndsur", en: "Wristwatch", de: "Armbanduhr" }, aliases: ["klokke", "ur", "armbåndsur", "watch", "wristwatch"] },
    { key: "BROOCH", names: { no: "Brosje / bunadssølv", en: "Brooch / costume silver", de: "Brosche / Trachtenschmuck" }, aliases: ["brosje", "bunadssølv", "sølje", "bunad", "brooch", "costume silver"] },
    { key: "OTHER_JEWELRY", names: { no: "Annet (smykker)", en: "Other jewelry", de: "Anderer Schmuck" } },
  ],
  TOOLS_HOUSE: [
    { key: "TOOLS", names: { no: "Verktøy (generelt)", en: "Tools", de: "Werkzeug" } },
    { key: "TOOLBOX", names: { no: "Verktøykasse", en: "Toolbox", de: "Werkzeugkasten" } },
    { key: "POWER_TOOL", names: { no: "Drill / batteriverktøy", en: "Drill / power tool", de: "Bohrmaschine / Elektrowerkzeug" }, aliases: ["drill", "batteridrill", "skrutrekker", "batteriverktøy", "power tool", "cordless drill"] },
    { key: "TOOL_BATTERY", names: { no: "Verktøybatteri", en: "Tool battery", de: "Werkzeugakku" } },
    { key: "MEASURING_TOOL", names: { no: "Måleinstrument", en: "Measuring tool", de: "Messwerkzeug" }, aliases: ["måleinstrument", "målebånd", "laser", "multimeter", "vater", "measuring tool", "tape measure"] },
    { key: "HEARING_PROTECTION", names: { no: "Hørselvern", en: "Hearing protection", de: "Gehörschutz" } },
    SHARED.WALKIE_TALKIE,
    { key: "OTHER_TOOLS", names: { no: "Annet (verktøy)", en: "Other tools", de: "Anderes Werkzeug" } },
  ],
  VEHICLE_TRANSPORT: [
    SHARED.CAR_KEYS,
    { key: "BICYCLE", names: { no: "Sykkel", en: "Bicycle", de: "Fahrrad" }, aliases: ["sykkel", "bike", "bicycle", "terrengsykkel", "racer"] },
    { key: "E_BIKE", names: { no: "Elsykkel", en: "E-bike", de: "E-Bike" }, aliases: ["elsykkel", "el-sykkel", "e-bike", "ebike"] },
    { key: "SCOOTER", names: { no: "Sparkesykkel", en: "Scooter", de: "Tretroller" }, aliases: ["sparkesykkel", "scooter", "kick scooter"] },
    { key: "E_SCOOTER", names: { no: "Elsparkesykkel", en: "E-scooter", de: "E-Scooter" }, aliases: ["elsparkesykkel", "el-sparkesykkel", "e-scooter", "escooter"] },
    { key: "BIKE_LOCK", names: { no: "Sykkellås", en: "Bike lock", de: "Fahrradschloss" } },
    { key: "BIKE_LIGHT", names: { no: "Sykkellykt", en: "Bike light", de: "Fahrradlicht" } },
    SHARED.BIKE_HELMET,
    { key: "MOTORCYCLE_HELMET", names: { no: "Motorsykkelhjelm", en: "Motorcycle helmet", de: "Motorradhelm" } },
    { key: "BIKE_COMPUTER", names: { no: "Sykkelcomputer", en: "Bike computer", de: "Fahrradcomputer" } },
    { key: "GARAGE_REMOTE", names: { no: "Garasjeåpner", en: "Garage remote", de: "Garagentoröffner" } },
    { key: "CHARGING_TAG", names: { no: "Ladebrikke", en: "Charging tag", de: "Ladechip" } },
    { key: "LICENSE_PLATE", names: { no: "Bilskilt", en: "License plate", de: "Kennzeichen" }, aliases: ["bilskilt", "skilt", "nummerskilt", "registreringsskilt", "license plate", "number plate"] },
    { key: "WHEEL_RIM", names: { no: "Hjul / felg", en: "Wheel / rim", de: "Rad / Felge" }, aliases: ["hjul", "felg", "felger", "hjulkapsel", "wheel", "rim", "hubcap"] },
    { key: "VEHICLE_ACCESSORY", names: { no: "Bildel / tilbehør", en: "Vehicle accessory", de: "Fahrzeugzubehör" } },
    { key: "OTHER_VEHICLE", names: { no: "Annet (sykkel/kjøretøy)", en: "Other bike/vehicle item", de: "Anderer Fahrrad-/Fahrzeugartikel" } },
  ],
  SPORT_OUTDOOR: [
    { key: "DISC_GOLF_DISC", names: { no: "Discgolfdisk", en: "Disc golf disc", de: "Discgolf-Scheibe" }, aliases: ["discgolfdisk", "disc golf disc", "sendeplate", "frisbee", "driver", "midrange", "putter"] },
    { key: "DISC_GOLF_BAG", names: { no: "Discgolfbag", en: "Disc golf bag", de: "Discgolf-Tasche" } },
    { key: "BALL", names: { no: "Ball", en: "Ball", de: "Ball" }, aliases: ["ball", "fotball", "håndball", "basketball", "volleyball", "football", "soccer ball", "handball"] },
    { key: "TENNIS_RACKET", names: { no: "Tennisracket", en: "Tennis racket", de: "Tennisschläger" } },
    { key: "PADEL_RACKET", names: { no: "Padelracket", en: "Padel racket", de: "Padelschläger" } },
    { key: "BADMINTON_RACKET", names: { no: "Badmintonracket", en: "Badminton racket", de: "Badmintonschläger" } },
    { key: "GOLF_CLUB", names: { no: "Golfkølle", en: "Golf club", de: "Golfschläger" } },
    { key: "GOLF_BAG", names: { no: "Golfbag", en: "Golf bag", de: "Golftasche" } },
    { key: "GOLF_RANGEFINDER", names: { no: "Golfavstandsmåler", en: "Golf rangefinder", de: "Golf-Entfernungsmesser" } },
    { key: "HOCKEY_STICK", names: { no: "Hockeykølle / innebandykølle", en: "Hockey / floorball stick", de: "Hockey- / Unihockeyschläger" }, aliases: ["hockeykølle", "innebandykølle", "kølle", "hockey stick", "floorball stick"] },
    { key: "ICE_SKATES", names: { no: "Skøyter", en: "Ice skates", de: "Schlittschuhe" }, aliases: ["skøyter", "skøyte", "hockeyskøyter", "ice skates", "skates"] },
    { key: "SKATEBOARD", names: { no: "Skateboard / longboard", en: "Skateboard / longboard", de: "Skateboard / Longboard" }, aliases: ["skateboard", "longboard", "brett"] },
    { key: "FISHING_ROD", names: { no: "Fiskestang", en: "Fishing rod", de: "Angelrute" } },
    { key: "FISHING_REEL", names: { no: "Fiskesnelle", en: "Fishing reel", de: "Angelrolle" } },
    { key: "HEADLAMP", names: { no: "Hodelykt", en: "Headlamp", de: "Stirnlampe" } },
    { key: "FLASHLIGHT", names: { no: "Lommelykt", en: "Flashlight", de: "Taschenlampe" } },
    { key: "BINOCULARS", names: { no: "Kikkert", en: "Binoculars", de: "Fernglas" }, aliases: ["kikkert", "binoculars"] },
    { key: "TREKKING_POLE", names: { no: "Turstav", en: "Trekking pole", de: "Wanderstock" } },
    { key: "CAMPING_GEAR", names: { no: "Campingutstyr", en: "Camping gear", de: "Campingausrüstung" } },
    { key: "TENT", names: { no: "Telt", en: "Tent", de: "Zelt" } },
    { key: "SLEEPING_BAG", names: { no: "Sovepose", en: "Sleeping bag", de: "Schlafsack" } },
    { key: "SLEEPING_PAD", names: { no: "Liggeunderlag", en: "Sleeping pad", de: "Isomatte" } },
    { key: "HIKING_BACKPACK", names: { no: "Tursekk", en: "Hiking backpack", de: "Wanderrucksack" } },
    { key: "THERMOS", names: { no: "Termos", en: "Thermos", de: "Thermosflasche" }, aliases: ["termos", "termokopp", "thermos", "vacuum flask"] },
    SHARED.WATER_BOTTLE,
    { key: "SKIS", names: { no: "Ski", en: "Skis", de: "Ski" } },
    { key: "SKI_POLE", names: { no: "Skistav", en: "Ski pole", de: "Skistock" } },
    { key: "SNOWBOARD", names: { no: "Snowboard", en: "Snowboard", de: "Snowboard" } },
    { key: "SLED", names: { no: "Akebrett / pulk", en: "Sled / pulk", de: "Schlitten / Pulka" }, aliases: ["akebrett", "pulk", "kjelke", "rattkjelke", "sled", "sledge"] },
    { key: "HELMET", names: { no: "Ski-/klatrehjelm", en: "Ski / climbing helmet", de: "Ski- / Kletterhelm" }, aliases: ["hjelm", "skihjelm", "klatrehjelm", "helmet", "ski helmet"] },
    SHARED.BIKE_HELMET,
    { key: "GOGGLES", names: { no: "Skibriller", en: "Ski goggles", de: "Skibrille" }, aliases: ["goggles", "skibriller", "ski goggles"] },
    { key: "SWIM_GOGGLES", names: { no: "Svømmebriller", en: "Swimming goggles", de: "Schwimmbrille" } },
    { key: "YOGA_MAT", names: { no: "Yogamatte / treningsmatte", en: "Yoga / exercise mat", de: "Yoga- / Trainingsmatte" }, aliases: ["yogamatte", "treningsmatte", "yoga mat", "exercise mat"] },
    SHARED.HEART_RATE_MONITOR,
    { key: "LIFE_JACKET", names: { no: "Redningsvest", en: "Life jacket", de: "Schwimmweste" } },
    { key: "KAYAK_PADDLE", names: { no: "Kajakkåre", en: "Kayak paddle", de: "Kajakpaddel" } },
    { key: "KAYAK_CANOE", names: { no: "Kajakk / kano / SUP-brett", en: "Kayak / canoe / SUP board", de: "Kajak / Kanu / SUP-Board" }, aliases: ["kajakk", "kano", "sup", "padlebrett", "kayak", "canoe", "paddle board"] },
    { key: "OTHER_SPORT", names: { no: "Annet (sport/friluft)", en: "Other sport/outdoor item", de: "Anderer Sport-/Outdoorartikel" } },
  ],
  CULTURE_HOBBY: [
    { key: "BOOK", names: { no: "Bok", en: "Book", de: "Buch" } },
    { key: "NOTEBOOK", names: { no: "Notatbok / dagbok", en: "Notebook / diary", de: "Notizbuch / Tagebuch" }, aliases: ["notatbok", "dagbok", "skrivebok", "notebook", "diary"] },
    { key: "PENCIL_CASE", names: { no: "Pennal", en: "Pencil case", de: "Federmäppchen" } },
    { key: "CALCULATOR", names: { no: "Kalkulator", en: "Calculator", de: "Taschenrechner" } },
    { key: "MUSICAL_INSTRUMENT", names: { no: "Instrument", en: "Musical instrument", de: "Musikinstrument" } },
    { key: "GUITAR", names: { no: "Gitar", en: "Guitar", de: "Gitarre" } },
    { key: "VIOLIN", names: { no: "Fiolin", en: "Violin", de: "Geige" } },
    { key: "INSTRUMENT_CASE", names: { no: "Instrumentkasse", en: "Instrument case", de: "Instrumentenkoffer" }, aliases: ["instrumentkasse", "gitarkasse", "fiolinkasse", "instrument case", "guitar case"] },
    { key: "ART_SUPPLIES", names: { no: "Kunstutstyr", en: "Art supplies", de: "Künstlerbedarf" } },
    { key: "CRAFT_ITEM", names: { no: "Håndarbeid", en: "Craft item", de: "Bastelsache" } },
    { key: "KEEPSAKE", names: { no: "Minnegjenstand / fotoalbum", en: "Keepsake / photo album", de: "Andenken / Fotoalbum" }, aliases: ["minnegjenstand", "fotoalbum", "album", "arvestykke", "keepsake", "photo album", "heirloom"] },
    SHARED.RC_VEHICLE,
    { key: "OTHER_HOBBY", names: { no: "Annet (skole/kultur/hobby)", en: "Other school/culture/hobby item", de: "Anderer Schul-/Kultur-/Hobbyartikel" } },
  ],
  CHILDREN_FAMILY: [
    { key: "STROLLER", names: { no: "Barnevogn", en: "Stroller", de: "Kinderwagen" }, aliases: ["barnevogn", "trille", "sportsvogn", "stroller", "pram", "buggy"] },
    { key: "STROLLER_FOOTMUFF", names: { no: "Kjørepose / vognpose", en: "Stroller footmuff", de: "Fußsack für Kinderwagen" }, aliases: ["kjørepose", "vognpose", "footmuff"] },
    { key: "STUFFED_TOY", names: { no: "Kosedyr", en: "Stuffed toy", de: "Kuscheltier" }, aliases: ["kosedyr", "bamse", "teddy bear", "stuffed toy", "plush"] },
    { key: "BABY_BLANKET", names: { no: "Koseklut / babyteppe", en: "Comfort blanket / baby blanket", de: "Kuscheldecke / Babydecke" }, aliases: ["koseklut", "snuttefilt", "babyteppe", "barneteppe", "comforter", "baby blanket", "lovey"] },
    { key: "DOLL", names: { no: "Dukke", en: "Doll", de: "Puppe" } },
    { key: "TOY", names: { no: "Leketøy", en: "Toy", de: "Spielzeug" }, aliases: ["leke", "leketøy", "toy"] },
    SHARED.RC_VEHICLE,
    { key: "PACIFIER", names: { no: "Smokk", en: "Pacifier", de: "Schnuller" }, aliases: ["smokk", "pacifier", "dummy"] },
    { key: "BABY_BOTTLE", names: { no: "Tåteflaske", en: "Baby bottle", de: "Babyflasche" } },
    { key: "LUNCH_BOX", names: { no: "Matboks", en: "Lunch box", de: "Brotdose" }, aliases: ["matboks", "lunch box"] },
    SHARED.WATER_BOTTLE,
    SHARED.SCHOOL_BAG,
    { key: "KIDS_RAINWEAR", names: { no: "Regntøy / dress (barn)", en: "Rain gear / snowsuit (kids)", de: "Regenkleidung / Schneeanzug (Kinder)" }, aliases: ["regntøy", "regndress", "vinterdress", "flyverdress", "parkdress", "rain gear", "snowsuit"] },
    { key: "CHILD_SEAT", names: { no: "Barnesete / sykkelsete", en: "Child seat / bike seat", de: "Kindersitz / Fahrradsitz" }, aliases: ["barnesete", "bilstol", "sykkelsete", "child seat", "car seat", "bike seat"] },
    { key: "BABY_CARRIER", names: { no: "Bæresele", en: "Baby carrier", de: "Babytrage" } },
    { key: "OTHER_CHILDREN", names: { no: "Annet (barn/familie)", en: "Other child/family item", de: "Anderer Kinder-/Familienartikel" } },
  ],
  PETS: [
    { key: "DOG", names: { no: "Hund", en: "Dog", de: "Hund" }, aliases: ["hund", "dog", "valp", "puppy"] },
    { key: "CAT", names: { no: "Katt", en: "Cat", de: "Katze" }, aliases: ["katt", "cat", "kitten", "kattunge"] },
    { key: "BIRD", names: { no: "Fugl", en: "Bird", de: "Vogel" }, aliases: ["fugl", "papegøye", "undulat", "bird", "parrot"] },
    { key: "RABBIT", names: { no: "Kanin", en: "Rabbit", de: "Kaninchen" } },
    { key: "SMALL_PET", names: { no: "Smådyr (marsvin, hamster o.l.)", en: "Small pet (guinea pig, hamster etc.)", de: "Kleintier (Meerschweinchen, Hamster usw.)" }, aliases: ["marsvin", "hamster", "rotte", "mus", "chinchilla", "guinea pig", "rat", "mouse"] },
    { key: "REPTILE", names: { no: "Reptil / skilpadde", en: "Reptile / turtle", de: "Reptil / Schildkröte" }, aliases: ["reptil", "skilpadde", "øgle", "slange", "reptile", "turtle", "tortoise", "lizard", "snake"] },
    { key: "HORSE", names: { no: "Hest", en: "Horse", de: "Pferd" } },
    { key: "PET_GEAR", names: { no: "Halsbånd / kobbel / sele", en: "Collar / leash / harness", de: "Halsband / Leine / Geschirr" }, aliases: ["halsbånd", "kobbel", "bånd", "sele", "hundesele", "collar", "leash", "harness"] },
    { key: "OTHER_PET", names: { no: "Annet (husdyr)", en: "Other pet", de: "Anderes Haustier" } },
    { key: "CUSTOM", names: { no: "Egendefinert (skriv selv)", en: "Custom (type your own)", de: "Eigene Angabe (selbst eingeben)" } },
  ],
};

// T1.9U: keys from the earlier list, mapped to the item that replaced them. Old reports and
// older app builds may still use them. Same map in server/lib/itemKeys.js and in the database
// function public.canonical_item_key (scripts/test-t1-9u.js checks that all three agree).
export const LEGACY_ITEM_KEYS: Record<string, string> = {
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
};

// Item names that a language writes as one word with the metal (Norwegian "gullring").
// Languages without an entry use the locale key catalog.metalItem ("Gold ring").
export const METAL_COMPOUND_NAMES: Partial<Record<Lang, Record<string, Record<string, string>>>> = {
  no: {
    gold: {
      RING: "Gullring", WEDDING_RING: "Gullgiftering", ENGAGEMENT_RING: "Gullforlovelsesring",
      WATCH: "Gullklokke", BRACELET: "Gullarmbånd",
      NECKLACE: "Gullhalskjede", EARRINGS: "Gulløredobber", PENDANT: "Gullanheng",
      BROOCH: "Gullbrosje",
    },
    silver: {
      RING: "Sølvring", WEDDING_RING: "Sølvgiftering", ENGAGEMENT_RING: "Sølvforlovelsesring",
      WATCH: "Sølvklokke", BRACELET: "Sølvarmbånd",
      NECKLACE: "Sølvhalskjede", EARRINGS: "Sølvøredobber", PENDANT: "Sølvanheng",
      BROOCH: "Sølvbrosje",
    },
    bronze: {
      RING: "Bronsering", WATCH: "Bronseklokke", BRACELET: "Bronsearmbånd",
      NECKLACE: "Bronsehalskjede", PENDANT: "Bronseanheng",
    },
  },
};

// "grey" is an older stored spelling of "gray". T1.9U: lime, cyan and magenta were folded into
// green, turquoise and pink (same map in server/lib/colorKeys.js and the T1.9U migration).
export const LEGACY_COLOR_KEYS: Record<string, string> = { lime: "green", cyan: "turquoise", magenta: "pink" };
const COLOR_KEY_ALIASES: Record<string, string> = { grey: "gray", ...LEGACY_COLOR_KEYS };

export const COLOR_CATALOG: CatalogEntry[] = [
  { key: "black", names: { no: "Svart", en: "Black", de: "Schwarz" } },
  { key: "white", names: { no: "Hvit", en: "White", de: "Weiß" } },
  { key: "gray", names: { no: "Grå", en: "Gray", de: "Grau" } },
  { key: "red", names: { no: "Rød", en: "Red", de: "Rot" } },
  { key: "orange", names: { no: "Oransje", en: "Orange", de: "Orange" } },
  { key: "yellow", names: { no: "Gul", en: "Yellow", de: "Gelb" } },
  { key: "green", names: { no: "Grønn", en: "Green", de: "Grün" } },
  { key: "blue", names: { no: "Blå", en: "Blue", de: "Blau" } },
  { key: "purple", names: { no: "Lilla", en: "Purple", de: "Lila" } },
  { key: "brown", names: { no: "Brun", en: "Brown", de: "Braun" } },
  { key: "pink", names: { no: "Rosa", en: "Pink", de: "Rosa" } },
  { key: "beige", names: { no: "Beige", en: "Beige", de: "Beige" } },
  { key: "navy", names: { no: "Mørkeblå", en: "Navy", de: "Marineblau" } },
  { key: "light-blue", names: { no: "Lyseblå", en: "Light blue", de: "Hellblau" } },
  { key: "turquoise", names: { no: "Turkis", en: "Turquoise", de: "Türkis" } },
  { key: "burgundy", names: { no: "Burgunder", en: "Burgundy", de: "Weinrot" } },
  { key: "olive", names: { no: "Oliven", en: "Olive", de: "Oliv" } },
  { key: "gold", names: { no: "Gull", en: "Gold", de: "Gold" } },
  { key: "silver", names: { no: "Sølv", en: "Silver", de: "Silber" } },
  { key: "bronze", names: { no: "Bronse", en: "Bronze", de: "Bronze" } },
  { key: "camo", names: { no: "Kamuflasje", en: "Camouflage", de: "Tarnmuster" } },
  { key: "multicolor", names: { no: "Flerfarget", en: "Multicolor", de: "Mehrfarbig" } },
  { key: "patterned", names: { no: "Mønstret", en: "Patterned", de: "Gemustert" } },
  { key: "unknown", names: { no: "Usikker", en: "Not sure", de: "Unsicher" } },
  { key: "other", names: { no: "Annet", en: "Other", de: "Andere" } },
];

const normKey = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const humanize = (v: unknown) =>
  String(v ?? "").replace(/_/g, " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());

const ITEM_INDEX = new Map<string, CatalogEntry>();
for (const category of CATEGORY_CATALOG)
  for (const e of ITEM_CATALOG[category.key] || []) if (!ITEM_INDEX.has(e.key)) ITEM_INDEX.set(e.key, e);

/** The current key for a stored item key (older keys map to the item that replaced them). */
export function canonicalItemKey(key: unknown): string {
  const k = normKey(key);
  return LEGACY_ITEM_KEYS[k] ?? k;
}

export function categoryEntry(key: unknown): CatalogEntry | undefined {
  const k = normKey(key);
  return CATEGORY_CATALOG.find((e) => e.key === k);
}

export function itemEntry(key: unknown, category?: unknown): CatalogEntry | undefined {
  const k = canonicalItemKey(key);
  const inCategory = category ? ITEM_CATALOG[normKey(category)]?.find((e) => e.key === k) : undefined;
  return inCategory ?? ITEM_INDEX.get(k);
}

export function colorEntry(key: unknown): CatalogEntry | undefined {
  const raw = String(key ?? "").trim().toLowerCase();
  const k = COLOR_KEY_ALIASES[raw] ?? raw;
  return COLOR_CATALOG.find((e) => e.key === k);
}

// Name for a stored key. Unknown keys are shown as readable text rather than hidden.
export function categoryName(key: unknown, lang: Lang): string {
  return categoryEntry(key)?.names[lang] ?? (key ? humanize(key) : "");
}

export function itemName(key: unknown, lang: Lang, category?: unknown): string {
  return itemEntry(key, category)?.names[lang] ?? (key ? humanize(key) : "");
}

export function colorName(key: unknown, lang: Lang): string {
  return colorEntry(key)?.names[lang] ?? String(key ?? "");
}

// All names and aliases of an item, for search in any language.
export function itemSearchText(key: unknown): string {
  const e = itemEntry(key);
  if (!e) return String(key ?? "");
  return [e.key, ...Object.values(e.names), ...(e.aliases ?? [])].join(" ");
}

// Finds the entry whose name in any language equals the given text (for older code paths that
// still pass a displayed name instead of a key).
export function findByName(list: CatalogEntry[], name: unknown): CatalogEntry | undefined {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return undefined;
  return list.find((e) => Object.values(e.names).some((x) => x.toLowerCase() === n));
}
