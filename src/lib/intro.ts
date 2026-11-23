// src/lib/intro.ts
// T1.9BQ: the three-screen intro is shown once per install.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const INTRO_KEY = "lof.intro.seen.v1";

export async function introSeen(): Promise<boolean> {
  try {
    return !!(await AsyncStorage.getItem(INTRO_KEY));
  } catch {
    return true; // never block the app on storage trouble
  }
}

export async function markIntroSeen() {
  try {
    await AsyncStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Seen again next time; harmless.
  }
}
