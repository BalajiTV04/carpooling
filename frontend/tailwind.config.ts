import type { Config } from "tailwindcss";

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "rgb(var(--color-accent))",
        brand: {
          DEFAULT: "rgb(var(--color-brand))",
          teal: "rgb(var(--color-brand-teal))",
          accent: "rgb(var(--color-accent))",
        },
        ink: "rgb(var(--color-ink))",
        muted: "rgb(var(--color-muted))",
        line: "rgb(var(--color-line))",
        surface: "rgb(var(--color-surface))",
        bg: "rgb(var(--color-bg))",
        card: "rgb(var(--color-card))",
        success: {
          DEFAULT: "rgb(var(--color-success))",
        },
        warn: {
          DEFAULT: "rgb(var(--color-warn))",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger))",
        },
        iris: {
          300: "rgb(var(--color-accent))",
          400: "rgb(var(--color-brand-teal))",
          500: "rgb(var(--color-brand))",
          600: "rgb(var(--color-brand))",
        },
        volt: {
          400: "rgb(var(--color-brand-teal))",
        },
        rose: {
          200: "rgb(var(--color-danger))",
          300: "rgb(var(--color-danger))",
          400: "rgb(var(--color-danger))",
          500: "rgb(var(--color-danger))",
        },
        amber: {
          400: "rgb(var(--color-warn))",
        },
        orange: {
          200: "rgb(var(--color-warn))",
          400: "rgb(var(--color-warn))",
          500: "rgb(var(--color-warn))",
        },
      },
      borderRadius: {
        lg: "var(--radius, 0.5rem)",
        md: "calc(var(--radius, 0.5rem) - 2px)",
        sm: "calc(var(--radius, 0.5rem) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-sans)"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(198, 255, 74, 0.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;
