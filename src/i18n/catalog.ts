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
  { key: "PERSONAL", names: { no: "Personlige eiendeler", en: "Personal belongings" } },
  { key: "ELECTRONICS", names: { no: "Elektronikk", en: "Electronics" } },
  { key: "BAGS_LUGGAGE", names: { no: "Vesker og bagasje", en: "Bags and luggage" } },
  { key: "CLOTHING_ACCESSORIES", names: { no: "Klær og tilbehør", en: "Clothing and accessories" } },
  { key: "JEWELRY", names: { no: "Smykker", en: "Jewelry" } },
  { key: "TOOLS_HOUSE", names: { no: "Verktøy", en: "Tools" } },
  { key: "VEHICLE_TRANSPORT", names: { no: "Bil / transport", en: "Vehicle / transport" } },
  { key: "SPORT_OUTDOOR", names: { no: "Sport og friluft", en: "Sports and outdoors" } },
  { key: "CULTURE_HOBBY", names: { no: "Kultur og hobby", en: "Culture and hobbies" } },
  { key: "CHILDREN_FAMILY", names: { no: "Barn og familie", en: "Children and family" } },
  { key: "PETS", names: { no: "Husdyr", en: "Pets" } },
];

export const ITEM_CATALOG: Record<string, CatalogEntry[]> = {
  PERSONAL: [
    { key: "KEYS", names: { no: "Nøkler", en: "Keys" }, aliases: ["nøkler", "nokler", "keys", "key", "nokkel", "nøkkel", "husnokkel", "bilnokkel"] },
    { key: "KEYCHAIN", names: { no: "Nøkkelknippe", en: "Keychain" }, aliases: ["nøkkelknippe", "nokkelknippe", "keychain", "key ring"] },
    { key: "HOUSE_KEY", names: { no: "Husnøkkel", en: "House key" } },
    { key: "WALLET", names: { no: "Lommebok", en: "Wallet" }, aliases: ["lommebok", "wallet", "purse"] },
    { key: "CASH", names: { no: "Kontanter", en: "Cash" } },
    { key: "MOBILE_PHONE", names: { no: "Mobiltelefon", en: "Mobile phone" }, aliases: ["mobil", "telefon", "iphone", "phone", "cellphone", "mobiltelefon", "mobile"] },
    { key: "SUNGLASSES", names: { no: "Solbriller", en: "Sunglasses" }, aliases: ["solbriller", "sunglasses", "sun glasses"] },
    { key: "GLASSES", names: { no: "Vanlige briller", en: "Glasses" }, aliases: ["briller", "vanlige briller", "glasses", "spectacles", "reading glasses"] },
    { key: "GLASSES_CASE", names: { no: "Brilleetui", en: "Glasses case" } },
    { key: "BANK_CARD", names: { no: "Bankkort", en: "Bank card" } },
    { key: "ACCESS_CARD", names: { no: "Adgangskort", en: "Access card" }, aliases: ["adgangskort", "nøkkelkort", "access card", "key card"] },
    { key: "ACCESS_TAG", names: { no: "Adgangsbrikke", en: "Access tag" } },
    { key: "TRAVEL_CARD", names: { no: "Reisekort", en: "Travel card" } },
    { key: "STUDENT_CARD", names: { no: "Studentkort", en: "Student card" } },
    { key: "ID_CARD", names: { no: "ID-kort", en: "ID card" } },
    { key: "PASSPORT", names: { no: "Pass", en: "Passport" } },
    { key: "DRIVER_LICENSE", names: { no: "Førerkort", en: "Driver's license" } },
    { key: "HEARING_AID", names: { no: "Høreapparat", en: "Hearing aid" } },
    { key: "MEDICATION", names: { no: "Medisiner", en: "Medication" } },
    { key: "MEDICATION_CASE", names: { no: "Medisinbeholder", en: "Medication case" } },
    { key: "CONTACT_LENS_CASE", names: { no: "Kontaktlinseetui", en: "Contact lens case" } },
    { key: "TOILETRY_BAG", names: { no: "Toalettmappe", en: "Toiletry bag" } },
    { key: "PERFUME", names: { no: "Parfyme", en: "Perfume" } },
    { key: "NAME_BADGE", names: { no: "Navneskilt", en: "Name badge" } },
    { key: "OTHER_PERSONAL", names: { no: "Annet (personlige)", en: "Other personal item" } },
  ],
  ELECTRONICS: [
    { key: "HEADPHONES", names: { no: "Hodetelefoner", en: "Headphones" }, aliases: ["hodetelefoner", "headphones", "airpods", "ørepropper", "orepropper", "earbuds", "earphones"] },
    { key: "EARBUDS", names: { no: "Ørepropper / AirPods", en: "Earbuds / AirPods" }, aliases: ["airpods", "ørepropper", "orepropper", "earbuds", "earphones"] },
    { key: "CHARGING_CASE", names: { no: "Ladeetui", en: "Charging case" }, aliases: ["ladeetui", "airpods etui", "charging case", "earbud case"] },
    { key: "SMARTWATCH", names: { no: "Smartklokke", en: "Smartwatch" }, aliases: ["smartklokke", "apple watch", "galaxy watch", "smartwatch"] },
    { key: "SPORT_WATCH", names: { no: "Sportsklokke", en: "Sports watch" } },
    { key: "FITNESS_TRACKER", names: { no: "Aktivitetsarmbånd", en: "Fitness tracker" } },
    { key: "TABLET", names: { no: "Nettbrett", en: "Tablet" } },
    { key: "LAPTOP", names: { no: "Bærbar PC", en: "Laptop" } },
    { key: "E_READER", names: { no: "E-bokleser", en: "E-reader" } },
    { key: "POWERBANK", names: { no: "Powerbank", en: "Power bank" } },
    { key: "CHARGER", names: { no: "Lader", en: "Charger" }, aliases: ["lader", "charger", "mobillader", "phone charger"] },
    { key: "CHARGING_CABLE", names: { no: "Ladekabel", en: "Charging cable" } },
    { key: "CAMERA", names: { no: "Kamera", en: "Camera" } },
    { key: "ACTION_CAMERA", names: { no: "Actionkamera", en: "Action camera" } },
    { key: "CAMERA_LENS", names: { no: "Kameralinse", en: "Camera lens" } },
    { key: "MEMORY_CARD", names: { no: "Minnekort", en: "Memory card" } },
    { key: "USB_DRIVE", names: { no: "USB-minne", en: "USB drive" } },
    { key: "EXTERNAL_DRIVE", names: { no: "Ekstern harddisk", en: "External drive" } },
    { key: "SPEAKER", names: { no: "Høyttaler", en: "Speaker" } },
    { key: "GAME_CONSOLE", names: { no: "Spillkonsoll", en: "Game console" } },
    { key: "GAME_CONTROLLER", names: { no: "Spillkontroller", en: "Game controller" } },
    { key: "STYLUS", names: { no: "Elektronisk penn", en: "Stylus" } },
    { key: "GPS_DEVICE", names: { no: "GPS", en: "GPS" } },
    { key: "TRACKER_TAG", names: { no: "Sporingsbrikke", en: "Tracker tag" }, aliases: ["airtag", "sporingsbrikke", "tracker tag", "smarttag"] },
    { key: "PHONE_CASE", names: { no: "Mobildeksel", en: "Phone case" } },
    { key: "DRONE", names: { no: "Drone", en: "Drone" }, aliases: ["drone", "quadrocopter", "quadcopter"] },
    { key: "DRONE_CONTROLLER", names: { no: "Dronekontroller", en: "Drone controller" }, aliases: ["dronekontroller", "fjernkontroll drone", "drone remote"] },
    { key: "DRONE_BATTERY", names: { no: "Dronebatteri", en: "Drone battery" } },
    { key: "OTHER_ELECTRONICS", names: { no: "Annet (elektronikk)", en: "Other electronics" } },
  ],
  BAGS_LUGGAGE: [
    { key: "BACKPACK", names: { no: "Ryggsekk", en: "Backpack" }, aliases: ["ryggsekk", "sekk", "backpack", "rucksack"] },
    { key: "HANDBAG", names: { no: "Håndveske", en: "Handbag" } },
    { key: "SHOULDER_BAG", names: { no: "Skulderveske", en: "Shoulder bag" } },
    { key: "WAIST_BAG", names: { no: "Belteveske", en: "Waist bag" } },
    { key: "SUITCASE", names: { no: "Koffert", en: "Suitcase" } },
    { key: "CABIN_SUITCASE", names: { no: "Kabinkoffert", en: "Cabin suitcase" } },
    { key: "TRAVEL_BAG", names: { no: "Reisebag", en: "Travel bag" } },
    { key: "GYM_BAG", names: { no: "Treningsbag", en: "Gym bag" } },
    { key: "SPORTS_BAG", names: { no: "Sportsbag", en: "Sports bag" } },
    { key: "LAPTOP_BAG", names: { no: "PC-veske", en: "Laptop bag" } },
    { key: "CAMERA_BAG", names: { no: "Kameraveske", en: "Camera bag" } },
    { key: "TOOL_BAG", names: { no: "Verktøybag", en: "Tool bag" } },
    { key: "DOCUMENT_BRIEFCASE", names: { no: "Dokumentmappe", en: "Document case" } },
    { key: "SCHOOL_BAG", names: { no: "Skolesekk", en: "School bag" } },
    { key: "TRAVEL_LUGGAGE", names: { no: "Reisebagasje", en: "Travel luggage" } },
    { key: "SHOPPING_BAG", names: { no: "Handlepose", en: "Shopping bag" } },
    { key: "TOTE_BAG", names: { no: "Tote-bag", en: "Tote bag" } },
    { key: "OTHER_BAGS", names: { no: "Annet (veske/bagasje)", en: "Other bag/luggage" } },
  ],
  CLOTHING_ACCESSORIES: [
    { key: "JACKET", names: { no: "Jakke", en: "Jacket" } },
    { key: "RAIN_JACKET", names: { no: "Regnjakke", en: "Rain jacket" } },
    { key: "DOWN_JACKET", names: { no: "Dunjakke", en: "Down jacket" } },
    { key: "FLEECE_JACKET", names: { no: "Fleecejakke", en: "Fleece jacket" } },
    { key: "VEST", names: { no: "Vest", en: "Vest" } },
    { key: "SWEATER", names: { no: "Genser", en: "Sweater" }, aliases: ["genser", "sweater", "jumper"] },
    { key: "HOODIE", names: { no: "Hettegenser", en: "Hoodie" }, aliases: ["hettegenser", "hoodie", "hooded sweater"] },
    { key: "CARDIGAN", names: { no: "Cardigan", en: "Cardigan" }, aliases: ["cardigan", "strikkejakke"] },
    { key: "FLEECE", names: { no: "Fleecegenser", en: "Fleece sweater" } },
    { key: "SHIRT", names: { no: "Skjorte", en: "Shirt" } },
    { key: "T_SHIRT", names: { no: "T-skjorte", en: "T-shirt" } },
    { key: "TOP", names: { no: "Topp", en: "Top" } },
    { key: "TROUSERS", names: { no: "Bukse", en: "Trousers" } },
    { key: "SHORTS", names: { no: "Shorts", en: "Shorts" } },
    { key: "DRESS", names: { no: "Kjole", en: "Dress" } },
    { key: "SKIRT", names: { no: "Skjørt", en: "Skirt" } },
    { key: "HAT", names: { no: "Lue", en: "Beanie" } },
    { key: "CAP", names: { no: "Caps", en: "Cap" } },
    { key: "BRIMMED_HAT", names: { no: "Hatt", en: "Hat" } },
    { key: "GLOVES", names: { no: "Hansker / votter", en: "Gloves / mittens" } },
    { key: "SCARF", names: { no: "Skjerf", en: "Scarf" } },
    { key: "BELT", names: { no: "Belte", en: "Belt" } },
    { key: "TIE", names: { no: "Slips", en: "Tie" } },
    { key: "SHOES", names: { no: "Sko", en: "Shoes" } },
    { key: "SNEAKERS", names: { no: "Joggesko", en: "Sneakers" } },
    { key: "BOOTS", names: { no: "Støvler", en: "Boots" } },
    { key: "SANDALS", names: { no: "Sandaler", en: "Sandals" } },
    { key: "UMBRELLA", names: { no: "Paraply", en: "Umbrella" } },
    { key: "REFLECTIVE_VEST", names: { no: "Refleksvest", en: "Reflective vest" } },
    { key: "OTHER_CLOTHING", names: { no: "Annet (klær/tilbehør)", en: "Other clothing/accessory" } },
  ],
  JEWELRY: [
    { key: "RING", names: { no: "Ring", en: "Ring" }, aliases: ["ring", "giftering", "forlovelsesring", "wedding ring", "engagement ring", "signetring"] },
    { key: "WEDDING_RING", names: { no: "Giftering", en: "Wedding ring" }, aliases: ["giftering", "wedding ring"] },
    { key: "ENGAGEMENT_RING", names: { no: "Forlovelsesring", en: "Engagement ring" }, aliases: ["forlovelsesring", "engagement ring"] },
    { key: "SIGNET_RING", names: { no: "Signetring", en: "Signet ring" } },
    { key: "EARRINGS", names: { no: "Øredobber", en: "Earrings" }, aliases: ["øredobber", "oredobber", "earrings", "earring"] },
    { key: "NECKLACE", names: { no: "Halskjede", en: "Necklace" }, aliases: ["halskjede", "necklace", "chain"] },
    { key: "PENDANT", names: { no: "Anheng", en: "Pendant" } },
    { key: "BRACELET", names: { no: "Armbånd", en: "Bracelet" }, aliases: ["armbånd", "armband", "bracelet"] },
    { key: "ANKLET", names: { no: "Fotlenke", en: "Anklet" } },
    { key: "WATCH", names: { no: "Klokke", en: "Watch" }, aliases: ["klokke", "ur", "watch"] },
    { key: "BROOCH", names: { no: "Brosje", en: "Brooch" } },
    { key: "CUFFLINKS", names: { no: "Mansjettknapper", en: "Cufflinks" } },
    { key: "JEWELRY_BOX", names: { no: "Smykkeskrin", en: "Jewelry box" } },
    { key: "OTHER_JEWELRY", names: { no: "Annet (smykker)", en: "Other jewelry" } },
  ],
  TOOLS_HOUSE: [
    { key: "TOOLS", names: { no: "Verktøy (generelt)", en: "Tools" } },
    { key: "TOOLBOX", names: { no: "Verktøykasse", en: "Toolbox" } },
    { key: "DRILL", names: { no: "Drill", en: "Drill" } },
    { key: "POWER_TOOL", names: { no: "Batteriverktøy", en: "Power tool" } },
    { key: "TOOL_BATTERY", names: { no: "Verktøybatteri", en: "Tool battery" } },
    { key: "MEASURING_TOOL", names: { no: "Måleinstrument", en: "Measuring tool" } },
    { key: "MULTIMETER", names: { no: "Multimeter", en: "Multimeter" } },
    { key: "LASER_TOOL", names: { no: "Laser", en: "Laser tool" } },
    { key: "HEARING_PROTECTION", names: { no: "Hørselvern", en: "Hearing protection" } },
    { key: "SAFETY_GLASSES", names: { no: "Vernebriller", en: "Safety glasses" } },
    { key: "WALKIE_TALKIE", names: { no: "Walkie-talkie", en: "Walkie-talkie" } },
    { key: "OTHER_TOOLS", names: { no: "Annet (verktøy)", en: "Other tools" } },
  ],
  VEHICLE_TRANSPORT: [
    { key: "CAR_KEYS", names: { no: "Bilnøkler", en: "Car keys" }, aliases: ["bilnokkel", "bilnøkler", "car key", "car keys", "carkey"] },
    { key: "BICYCLE", names: { no: "Sykkel", en: "Bicycle" }, aliases: ["sykkel", "bike", "bicycle"] },
    { key: "E_BIKE", names: { no: "Elsykkel", en: "E-bike" } },
    { key: "SCOOTER", names: { no: "Sparkesykkel", en: "Scooter" } },
    { key: "E_SCOOTER", names: { no: "Elsparkesykkel", en: "E-scooter" } },
    { key: "BIKE_LOCK", names: { no: "Sykkellås", en: "Bike lock" } },
    { key: "BIKE_LIGHT", names: { no: "Sykkellykt", en: "Bike light" } },
    { key: "BIKE_HELMET", names: { no: "Sykkelhjelm", en: "Bike helmet" } },
    { key: "MOTORCYCLE_HELMET", names: { no: "Motorsykkelhjelm", en: "Motorcycle helmet" } },
    { key: "BIKE_COMPUTER", names: { no: "Sykkelcomputer", en: "Bike computer" } },
    { key: "GARAGE_REMOTE", names: { no: "Garasjeåpner", en: "Garage remote" } },
    { key: "CHARGING_TAG", names: { no: "Ladebrikke", en: "Charging tag" } },
    { key: "VEHICLE_ACCESSORY", names: { no: "Bildel / tilbehør", en: "Vehicle accessory" } },
    { key: "OTHER_VEHICLE", names: { no: "Annet (bil/transport)", en: "Other vehicle/transport" } },
  ],
  SPORT_OUTDOOR: [
    { key: "DISC_GOLF_DISC", names: { no: "Discgolfdisk", en: "Disc golf disc" }, aliases: ["discgolfdisk", "disc golf disc", "sendeplate", "frisbee"] },
    { key: "DISC_GOLF_DRIVER", names: { no: "Discgolf-driver", en: "Disc golf driver" }, aliases: ["driver", "distance driver", "fairway driver", "sendeplate"] },
    { key: "DISC_GOLF_MIDRANGE", names: { no: "Discgolf-midrange", en: "Disc golf midrange" }, aliases: ["midrange", "mid range", "sendeplate"] },
    { key: "DISC_GOLF_PUTTER", names: { no: "Discgolf-putter", en: "Disc golf putter" }, aliases: ["putter", "putting disc", "sendeplate"] },
    { key: "DISC_GOLF_BAG", names: { no: "Discgolfbag", en: "Disc golf bag" } },
    { key: "FOOTBALL", names: { no: "Fotball", en: "Football" } },
    { key: "HANDBALL", names: { no: "Håndball", en: "Handball" } },
    { key: "BASKETBALL", names: { no: "Basketball", en: "Basketball" } },
    { key: "VOLLEYBALL", names: { no: "Volleyball", en: "Volleyball" } },
    { key: "TENNIS_RACKET", names: { no: "Tennisracket", en: "Tennis racket" } },
    { key: "PADEL_RACKET", names: { no: "Padelracket", en: "Padel racket" } },
    { key: "BADMINTON_RACKET", names: { no: "Badmintonracket", en: "Badminton racket" } },
    { key: "GOLF_CLUB", names: { no: "Golfkølle", en: "Golf club" } },
    { key: "GOLF_BAG", names: { no: "Golfbag", en: "Golf bag" } },
    { key: "GOLF_RANGEFINDER", names: { no: "Golfavstandsmåler", en: "Golf rangefinder" } },
    { key: "FISHING_ROD", names: { no: "Fiskestang", en: "Fishing rod" } },
    { key: "FISHING_REEL", names: { no: "Fiskesnelle", en: "Fishing reel" } },
    { key: "HEADLAMP", names: { no: "Hodelykt", en: "Headlamp" } },
    { key: "FLASHLIGHT", names: { no: "Lommelykt", en: "Flashlight" } },
    { key: "COMPASS", names: { no: "Kompass", en: "Compass" } },
    { key: "TREKKING_POLE", names: { no: "Turstav", en: "Trekking pole" } },
    { key: "CAMPING_GEAR", names: { no: "Campingutstyr", en: "Camping gear" } },
    { key: "TENT", names: { no: "Telt", en: "Tent" } },
    { key: "SLEEPING_BAG", names: { no: "Sovepose", en: "Sleeping bag" } },
    { key: "SLEEPING_PAD", names: { no: "Liggeunderlag", en: "Sleeping pad" } },
    { key: "HIKING_BACKPACK", names: { no: "Tursekk", en: "Hiking backpack" } },
    { key: "SKIS", names: { no: "Ski", en: "Skis" } },
    { key: "SKI_POLE", names: { no: "Skistav", en: "Ski pole" } },
    { key: "SNOWBOARD", names: { no: "Snowboard", en: "Snowboard" } },
    { key: "HELMET", names: { no: "Hjelm", en: "Helmet" } },
    { key: "GOGGLES", names: { no: "Goggles", en: "Goggles" } },
    { key: "SWIM_GOGGLES", names: { no: "Svømmebriller", en: "Swimming goggles" } },
    { key: "WATER_BOTTLE", names: { no: "Drikkeflaske", en: "Water bottle" } },
    { key: "HEART_RATE_MONITOR", names: { no: "Pulsmåler", en: "Heart rate monitor" } },
    { key: "LIFE_JACKET", names: { no: "Redningsvest", en: "Life jacket" } },
    { key: "KAYAK_PADDLE", names: { no: "Kajakkåre", en: "Kayak paddle" } },
    { key: "OTHER_SPORT", names: { no: "Annet (sport/friluft)", en: "Other sport/outdoor item" } },
  ],
  CULTURE_HOBBY: [
    { key: "BOOK", names: { no: "Bok", en: "Book" } },
    { key: "NOTEBOOK", names: { no: "Notatbok", en: "Notebook" } },
    { key: "DIARY", names: { no: "Dagbok", en: "Diary" } },
    { key: "PENCIL_CASE", names: { no: "Pennal", en: "Pencil case" } },
    { key: "CALCULATOR", names: { no: "Kalkulator", en: "Calculator" } },
    { key: "MUSICAL_INSTRUMENT", names: { no: "Instrument", en: "Musical instrument" } },
    { key: "GUITAR", names: { no: "Gitar", en: "Guitar" } },
    { key: "VIOLIN", names: { no: "Fiolin", en: "Violin" } },
    { key: "ART_SUPPLIES", names: { no: "Kunstutstyr", en: "Art supplies" } },
    { key: "CRAFT_ITEM", names: { no: "Håndarbeid", en: "Craft item" } },
    { key: "BOARD_GAME", names: { no: "Brettspill", en: "Board game" } },
    { key: "PLAYING_CARDS", names: { no: "Spillkort", en: "Playing cards" } },
    { key: "RC_VEHICLE", names: { no: "Fjernstyrt kjøretøy", en: "Remote-controlled vehicle" } },
    { key: "OTHER_HOBBY", names: { no: "Annet (kultur/hobby)", en: "Other culture/hobby item" } },
  ],
  CHILDREN_FAMILY: [
    { key: "STROLLER", names: { no: "Barnevogn", en: "Stroller" } },
    { key: "STUFFED_TOY", names: { no: "Kosedyr", en: "Stuffed toy" }, aliases: ["kosedyr", "bamse", "teddy bear", "stuffed toy"] },
    { key: "DOLL", names: { no: "Dukke", en: "Doll" } },
    { key: "PACIFIER", names: { no: "Smokk", en: "Pacifier" }, aliases: ["smokk", "pacifier", "dummy"] },
    { key: "BABY_BOTTLE", names: { no: "Tåteflaske", en: "Baby bottle" } },
    { key: "LUNCH_BOX", names: { no: "Matboks", en: "Lunch box" }, aliases: ["matboks", "lunch box"] },
    { key: "CHILD_WATER_BOTTLE", names: { no: "Drikkeflaske", en: "Child's water bottle" } },
    { key: "TOY", names: { no: "Leketøy", en: "Toy" } },
    { key: "CHILD_BACKPACK", names: { no: "Barnesekk", en: "Child's backpack" } },
    { key: "BABY_BLANKET", names: { no: "Barneteppe", en: "Baby blanket" } },
    { key: "BABY_CARRIER", names: { no: "Bæresele", en: "Baby carrier" } },
    { key: "OTHER_CHILDREN", names: { no: "Annet (barn/familie)", en: "Other child/family item" } },
  ],
  PETS: [
    { key: "DOG", names: { no: "Hund", en: "Dog" }, aliases: ["hund", "dog", "valp", "puppy"] },
    { key: "CAT", names: { no: "Katt", en: "Cat" }, aliases: ["katt", "cat", "kitten"] },
    { key: "BIRD", names: { no: "Fugl", en: "Bird" } },
    { key: "RABBIT", names: { no: "Kanin", en: "Rabbit" } },
    { key: "GUINEA_PIG", names: { no: "Marsvin", en: "Guinea pig" } },
    { key: "HAMSTER", names: { no: "Hamster", en: "Hamster" } },
    { key: "TURTLE", names: { no: "Skilpadde", en: "Turtle" } },
    { key: "REPTILE", names: { no: "Reptil", en: "Reptile" } },
    { key: "HORSE", names: { no: "Hest", en: "Horse" } },
    { key: "PET_COLLAR", names: { no: "Halsbånd", en: "Pet collar" } },
    { key: "PET_LEASH", names: { no: "Kobbel", en: "Pet leash" } },
    { key: "PET_HARNESS", names: { no: "Sele", en: "Pet harness" } },
    { key: "OTHER_PET", names: { no: "Annet (husdyr)", en: "Other pet" } },
    { key: "CUSTOM", names: { no: "Egendefinert (skriv selv)", en: "Custom (type your own)" } },
  ],
};

// Item names that a language writes as one word with the metal (Norwegian "gullring").
// Languages without an entry use the locale key catalog.metalItem ("Gold ring").
export const METAL_COMPOUND_NAMES: Partial<Record<Lang, Record<string, Record<string, string>>>> = {
  no: {
    gold: {
      RING: "Gullring", WEDDING_RING: "Gullgiftering", ENGAGEMENT_RING: "Gullforlovelsesring",
      SIGNET_RING: "Gullsignetring", WATCH: "Gullklokke", BRACELET: "Gullarmbånd",
      NECKLACE: "Gullhalskjede", EARRINGS: "Gulløredobber", PENDANT: "Gullanheng",
      BROOCH: "Gullbrosje", CUFFLINKS: "Gullmansjettknapper",
    },
    silver: {
      RING: "Sølvring", WEDDING_RING: "Sølvgiftering", ENGAGEMENT_RING: "Sølvforlovelsesring",
      SIGNET_RING: "Sølvsignetring", WATCH: "Sølvklokke", BRACELET: "Sølvarmbånd",
      NECKLACE: "Sølvhalskjede", EARRINGS: "Sølvøredobber", PENDANT: "Sølvanheng",
      BROOCH: "Sølvbrosje", CUFFLINKS: "Sølvmansjettknapper",
    },
    bronze: {
      RING: "Bronsering", WATCH: "Bronseklokke", BRACELET: "Bronsearmbånd",
      NECKLACE: "Bronsehalskjede", PENDANT: "Bronseanheng",
    },
  },
};

// "grey" is an older stored spelling of "gray".
const COLOR_KEY_ALIASES: Record<string, string> = { grey: "gray" };

export const COLOR_CATALOG: CatalogEntry[] = [
  { key: "black", names: { no: "Svart", en: "Black" } },
  { key: "white", names: { no: "Hvit", en: "White" } },
  { key: "gray", names: { no: "Grå", en: "Gray" } },
  { key: "red", names: { no: "Rød", en: "Red" } },
  { key: "orange", names: { no: "Oransje", en: "Orange" } },
  { key: "yellow", names: { no: "Gul", en: "Yellow" } },
  { key: "green", names: { no: "Grønn", en: "Green" } },
  { key: "blue", names: { no: "Blå", en: "Blue" } },
  { key: "purple", names: { no: "Lilla", en: "Purple" } },
  { key: "brown", names: { no: "Brun", en: "Brown" } },
  { key: "pink", names: { no: "Rosa", en: "Pink" } },
  { key: "beige", names: { no: "Beige", en: "Beige" } },
  { key: "navy", names: { no: "Mørkeblå", en: "Navy" } },
  { key: "light-blue", names: { no: "Lyseblå", en: "Light blue" } },
  { key: "turquoise", names: { no: "Turkis", en: "Turquoise" } },
  { key: "burgundy", names: { no: "Burgunder", en: "Burgundy" } },
  { key: "lime", names: { no: "Lime", en: "Lime" } },
  { key: "cyan", names: { no: "Cyan", en: "Cyan" } },
  { key: "magenta", names: { no: "Magenta", en: "Magenta" } },
  { key: "olive", names: { no: "Oliven", en: "Olive" } },
  { key: "gold", names: { no: "Gull", en: "Gold" } },
  { key: "silver", names: { no: "Sølv", en: "Silver" } },
  { key: "bronze", names: { no: "Bronse", en: "Bronze" } },
  { key: "camo", names: { no: "Kamuflasje", en: "Camouflage" } },
  { key: "multicolor", names: { no: "Flerfarget", en: "Multicolor" } },
  { key: "patterned", names: { no: "Mønstret", en: "Patterned" } },
  { key: "unknown", names: { no: "Usikker", en: "Not sure" } },
  { key: "other", names: { no: "Annet", en: "Other" } },
];

const normKey = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const humanize = (v: unknown) =>
  String(v ?? "").replace(/_/g, " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());

const ITEM_INDEX = new Map<string, CatalogEntry>();
for (const list of Object.values(ITEM_CATALOG)) for (const e of list) if (!ITEM_INDEX.has(e.key)) ITEM_INDEX.set(e.key, e);

export function categoryEntry(key: unknown): CatalogEntry | undefined {
  const k = normKey(key);
  return CATEGORY_CATALOG.find((e) => e.key === k);
}

export function itemEntry(key: unknown, category?: unknown): CatalogEntry | undefined {
  const k = normKey(key);
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
