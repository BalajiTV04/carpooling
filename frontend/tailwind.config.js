/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Direction B — Indigo + Lime Night Mobility (dark-first)
        night: {
          950: "#070A1A",
          900: "#0B1030",
          850: "#111742",
          800: "#1A2154",
          700: "#2A3272"
        },
        volt: {
          300: "#D8FF7A",
          400: "#C6FF4A",
          500: "#AEEB2E",
          600: "#8BC81A"
        },
        iris: {
          300: "#B9B8FF",
          400: "#9A97FF",
          500: "#7B77FF",
          600: "#5B57E8"
        }
      },
      fontFamily: {
        display: ["\"Sora\"", "system-ui", "sans-serif"],
        body: ["\"Inter\"", "system-ui", "sans-serif"]
      },
      borderRadius: {
        xl2: "1.25rem",
        xl3: "1.75rem"
      },
      boxShadow: {
        glow: "0 0 24px rgba(198,255,74,.35)",
        card: "0 12px 40px rgba(3,6,20,.55)"
      }
    }
  },
  plugins: []
};
