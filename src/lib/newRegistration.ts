// src/lib/newRegistration.ts
// T1.9K: switch between the current registration screen and the new one-page registration
// (Profil → "Prøv ny registrering"). Stored per phone. When one of them has been chosen, this
// switch and the screen that lost are removed.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@lostfound:newRegistration:v1";
let cached: boolean | null = null;
const listeners = new Set<(value: boolean) => void>();

async function load(): Promise<boolean> {
  if (cached != null) return cached;
  try {
    cached = (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
  } catch {
    cached = false;
  }
  return cached;
}

export async function setNewRegistration(value: boolean) {
  cached = value;
  listeners.forEach((fn) => fn(value));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // The choice still applies until the app restarts.
  }
}

/** [enabled, set]. Starts as false until the stored value is read. */
export function useNewRegistration(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let alive = true;
    void load().then((v) => alive && setEnabled(v));
    listeners.add(setEnabled);
    return () => {
      alive = false;
      listeners.delete(setEnabled);
    };
  }, []);
  return [enabled, (value: boolean) => void setNewRegistration(value)];
}

/** Where "register lost/found" leads with the current switch. */
export function registerRoute(enabled: boolean, type: "LOST" | "FOUND") {
  return { pathname: enabled ? "/(report)/register" : "/(report)/create-report", params: { type } } as const;
}
