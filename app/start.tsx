// app/start.tsx
// T1.9W: the start of a registration is the new chooser (lost or found) for everyone.
import React from "react";
import { Stack } from "expo-router";
import { RegisterChoice } from "../src/ui/RegisterChoice";

export default function StartScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RegisterChoice />
    </>
  );
}
