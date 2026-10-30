// src/ui/theme.ts
export const theme = {
  colors: {
    bg: "#F7F8FA",
    card: "#FFFFFF",
    text: "#0F172A",
    muted: "#64748B",
    border: "#E5E7EB",
    primary: "#111827",
    danger: "#DC2626",
    inputBg: "#FFFFFF",
    chipBg: "#EEF2F6",
    // T1.9F: secondary text with 4.5:1 contrast on white and on bg.
    textSecondary: "#475569",
    divider: "#F1F5F9",
    dangerStrong: "#B91C1C",
    unread: "#1D4ED8",
  },
  // Tinted surfaces: text colour, background and border for each meaning.
  tone: {
    info: { fg: "#1E3A8A", icon: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
    success: { fg: "#14532D", icon: "#166534", bg: "#F0FDF4", border: "#BBF7D0" },
    warning: { fg: "#78350F", icon: "#92400E", bg: "#FFFBEB", border: "#FCD34D" },
    error: { fg: "#881337", icon: "#BE123C", bg: "#FFF1F2", border: "#FECDD3" },
  },
  // Match level badges (light background, dark text).
  score: {
    excellent: { fg: "#14532D", bg: "#DCFCE7" },
    good: { fg: "#1E3A8A", bg: "#DBEAFE" },
    possible: { fg: "#78350F", bg: "#FEF3C7" },
    low: { fg: "#334155", bg: "#E2E8F0" },
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 18,
    pill: 999,
  },
  space: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
  },
  type: {
    h1: 22,
    h2: 18,
    body: 15,
    caption: 12,
    small: 11,
  },
  shadow: {
    card: {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
  },
} as const;

