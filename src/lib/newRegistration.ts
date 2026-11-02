// src/lib/newRegistration.ts
// T1.9K introduced a switch between the old registration screen and the one-page registration.
// T1.9W: the one-page registration is the only way to register. The old screen
// (app/(report)/create-report.tsx) is kept only for editing an existing case.
// useNewRegistration and the route argument stay so older call sites keep compiling.

/** Always [true, no-op]: the new registration is the default for everyone. */
export function useNewRegistration(): [boolean, (value: boolean) => void] {
  return [true, () => {}];
}

/** Where "register lost/found" leads. */
export function registerRoute(_enabled: boolean, type: "LOST" | "FOUND") {
  return { pathname: "/(report)/register", params: { type } } as const;
}
