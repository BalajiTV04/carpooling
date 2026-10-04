// Local place catalogue for the fuzzy picker (Phase 3).
//
// Why a local catalogue at all? The backend /geo/search needs a login token and
// Nominatim has no typo tolerance, so a logged-out visitor typing "Man miss"
// would get nothing. This catalogue makes the common corridor searchable
// INSTANTLY, offline, with no rate limit — the backend Nominatim search is then
// merged in as a secondary source for anything outside the list.
//
// Coordinates are [lng, lat] to match the GeoJSON convention used everywhere
// else in this project (PlaceHit.lat/lng are swapped on the way to the API).
export type CatalogPlace = {
  name: string;
  area: string;
  coordinates: [number, number];
  aliases?: string[];
};

export const CATALOG: CatalogPlace[] = [
  // ── Bengaluru core ──────────────────────────────────────────────────────
  { name: "Hebbal", area: "Bengaluru", coordinates: [77.5946, 13.0358], aliases: ["hebball", "hebbal junction"] },
  { name: "MG Road", area: "Bengaluru", coordinates: [77.6095, 12.9757], aliases: ["mg road", "mahadevappa"] },
  { name: "Whitefield", area: "Bengaluru", coordinates: [77.7499, 12.9698], aliases: ["white feild", "whitefeild"] },
  { name: "Electronic City", area: "Bengaluru", coordinates: [77.67, 12.8452], aliases: ["ec phase 1", "electroniccity", "e city"] },
  { name: "Indiranagar", area: "Bengaluru", coordinates: [77.6408, 12.9784], aliases: ["indira nagar"] },
  { name: "Koramangala", area: "Bengaluru", coordinates: [77.6245, 12.9352], aliases: ["koramangla"] },
  { name: "HSR Layout", area: "Bengaluru", coordinates: [77.6474, 12.9116], aliases: ["hsr"] },
  { name: "BTM Layout", area: "Bengaluru", coordinates: [77.6136, 12.9166], aliases: ["btm"] },
  { name: "Jayanagar", area: "Bengaluru", coordinates: [77.5535, 12.9250], aliases: ["jayanagar 4th block"] },
  { name: "Rajajinagar", area: "Bengaluru", coordinates: [77.5518, 12.9915] },
  { name: "Yeshwanthpur", area: "Bengaluru", coordinates: [77.5546, 13.0294], aliases: ["yeshwantpur"] },
  { name: "Marathahalli", area: "Bengaluru", coordinates: [77.7011, 12.9581], aliases: ["maratha halli"] },
  { name: "Banashankari", area: "Bengaluru", coordinates: [77.5665, 12.9250] },
  { name: "Malleswaram", area: "Bengaluru", coordinates: [77.5700, 13.0035], aliases: ["malleshwaram"] },
  { name: "Vidhana Soudha", area: "Bengaluru", coordinates: [77.5599, 12.9794] },
  { name: "Kempegowda Airport", area: "Bengaluru", coordinates: [77.7094, 13.1986], aliases: ["blr", "kia", "airport"] },
  { name: "Nelamangala", area: "Bengaluru", coordinates: [77.3926, 13.0993] },
  { name: "Yelahanka", area: "Bengaluru", coordinates: [77.5969, 13.1007] },
  { name: "Banashankari Bus Stand", area: "Bengaluru", coordinates: [77.5600, 12.9290] },

  // ── Around Bengaluru ────────────────────────────────────────────────────
  { name: "Sarjapur Road", area: "Bengaluru Rural", coordinates: [77.7832, 12.9081], aliases: ["sarjapur"] },
  { name: "Old Airport Road", area: "Bengaluru", coordinates: [77.6489, 12.9601] },
  { name: "Hosur Road", area: "Bengaluru", coordinates: [77.7710, 12.8459], aliases: ["hosur rd"] },
  { name: "Tumkur Road", area: "Bengaluru", coordinates: [77.4890, 13.0600], aliases: ["tumkur rd", "nh 44"] },
  { name: "Kanakapura Road", area: "Bengaluru", coordinates: [77.4833, 12.8000], aliases: ["kanakapura"] },
  { name: "Bidadi", area: "Bengaluru Rural", coordinates: [77.2742, 12.8600], aliases: ["bidadi road"] },

  // ── Rest of Karnataka (these used to be unreachable by the old viewbox) ──
  { name: "Mandya", area: "Mandya District", coordinates: [76.9455, 12.5218], aliases: ["mandya city", "mandya town", "man miss", "mandhya"] },
  { name: "Mysuru", area: "Mysuru District", coordinates: [76.6551, 12.2958], aliases: ["mysore", "mysuru city"] },
  { name: "Mysore Palace", area: "Mysuru", coordinates: [76.6545, 12.3052] },
  { name: "Tumakuru", area: "Tumakuru District", coordinates: [77.1025, 13.3392], aliases: ["tumkur", "tumakuru city"] },
  { name: "Tumkur", area: "Tumakuru District", coordinates: [77.1025, 13.3392] },
  { name: "Kolar", area: "Kolar District", coordinates: [78.1372, 13.1015] },
  { name: "Chikkaballapur", area: "Chikkaballapur", coordinates: [77.6938, 13.4391], aliases: ["chikballapur", "chikkaballpur"] },
  { name: "Hassan", area: "Hassan District", coordinates: [75.9787, 12.8699] },
  { name: "Haveri", area: "Haveri District", coordinates: [75.3962, 14.7936] },
  { name: "Hubballi", area: "Dharwad", coordinates: [75.1240, 15.3647], aliases: ["hubli", "hubballi"] },
  { name: "Belagavi", area: "Belagavi", coordinates: [74.4977, 15.8497], aliases: ["belgaum", "belagavi city"] },
  { name: "Davanagere", area: "Davanagere", coordinates: [75.9218, 14.4644], aliases: ["davangere"] },
  { name: "Shivamogga", area: "Shivamogga", coordinates: [75.5681, 13.9299], aliases: ["shimoga", "shivamoga"] },
  { name: "Mangaluru", area: "Dakshina Kannada", coordinates: [74.8563, 12.9141], aliases: ["mangalore", "mangaluru city"] },
  { name: "Udupi", area: "Udupi", coordinates: [74.7561, 13.3387] },
  { name: "Chikmagalur", area: "Chikmagalur", coordinates: [75.7713, 13.2462], aliases: ["chikmagalore", "chikmangalur"] },
  { name: "Bidar", area: "Bidar", coordinates: [77.5173, 17.9144] },
  { name: "Kalaburagi", area: "Kalaburagi", coordinates: [76.9550, 17.3297], aliases: ["gulbarga"] },
  { name: "Ballari", area: "Ballari", coordinates: [76.9214, 15.1394], aliases: ["bellary", "ballari city"] },
  { name: "Kolar Gold Fields", area: "Kolar", coordinates: [78.0208, 12.9111], aliases: ["kgf"] }
];
