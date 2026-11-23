// src/lib/mapStyle.ts
// T1.9BQ: Apple Maps in its muted style, so the app's pins and areas are what stands out.
import { Platform } from "react-native";

export const APP_MAP_TYPE = (Platform.OS === "ios" ? "mutedStandard" : "standard") as "mutedStandard" | "standard";
