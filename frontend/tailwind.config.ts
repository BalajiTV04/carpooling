import type { Config } from "tailwindcss";

/**
 * Design tokens live in app/globals.css as `--token: R G B` channel triplets,
 * mapped here with the `rgb(var(--token) / <alpha-value>)` pattern so every
 * utility supports opacity modifiers (e.g. `bg-accent/15`) and both themes
 * (dark default, light via [data-theme="light"]) work from one class list.
 *
 * Semantic tokens (Step 1): bg surface line ink muted accent on-accent
 * info danger warn success. The legacy night/volt/iris families are kept
 * for existing markup but are var-backed, so they flip with the theme too.
 */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic palette
        bg: v("--color-bg"),
        surface: v("--color-surface"),
        line: v("--color-line"),
        ink: v("--color-ink"),
        muted: v("--color-muted"),
        accent: v("--color-accent"),
        "on-accent": v("--color-on-accent"),
        info: v("--color-info"),
        danger: v("--color-danger"),
        warn: v("--color-warn"),
        success: v("--color-success"),
        // Direction B — Indigo + Lime Night Mobility (theme-aware)
        night: {
          950: v("--night-950"),
          900: v("--night-900"),
          850: v("--night-850"),
          800: v("--night-800"),
          700: v("--night-700")
        },
        volt: {
          300: v("--volt-300"),
          400: v("--volt-400"),
          500: v("--volt-500"),
          600: v("--volt-600")
        },
        iris: {
          300: v("--iris-300"),
          400: v("--iris-400"),
          500: v("--iris-500"),
          600: v("--iris-600")
        }
      },
      fontFamily: {
        // next/font variables (Plus Jakarta Sans + JetBrains Mono).
        sans: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        mono: ["var(--font-num)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      borderRadius: {
        xl2: "1.25rem",
        xl3: "1.75rem",
        card: "1rem",     // 16px — the card radius token
        pill: "9999px"
      },
      spacing: {
        // 8px step scale (supplement to Tailwind's default).
        18: "4.5rem",
        22: "5.5rem"
      },
      transitionTimingFunction: {
        // One easing curve everywhere: "smooth acceleration".
        velocity: "cubic-bezier(0.16, 1, 0.3, 1)"
      },
      boxShadow: {
        glow: "0 0 24px rgb(var(--volt-400) / .35)",
        card: "0 12px 40px rgb(var(--color-bg) / .55)",
        lift: "0 16px 44px rgb(var(--color-bg) / .6)",
        head: "0 14px 40px rgb(var(--color-bg) / .5)"
      },
      backgroundImage: {
        volt: "linear-gradient(100deg, rgb(var(--btn-a)), rgb(var(--btn-b)))",
        iris: "linear-gradient(100deg, rgb(var(--iris-500)), rgb(var(--iris-600)))"
      }
    }
  },
  plugins: []
};

export default config;
