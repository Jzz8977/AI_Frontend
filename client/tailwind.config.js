/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        "border-hi": "var(--border-hi)",
        text: "var(--text)",
        "text-dim": "var(--text-dim)",
        "text-muted": "var(--text-muted)",
        green: "var(--green)",
        "green-dim": "var(--green-dim)",
        amber: "var(--amber)",
        red: "var(--red)",
        blue: "var(--blue)",

        border: "var(--border)",
        input: "var(--border)",
        ring: "var(--green)",
        background: "var(--bg)",
        foreground: "var(--text)",
        primary: {
          DEFAULT: "var(--green)",
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "var(--panel-2)",
          foreground: "var(--text)",
        },
        destructive: {
          DEFAULT: "var(--red)",
          foreground: "#000000",
        },
        muted: {
          DEFAULT: "var(--panel-2)",
          foreground: "var(--text-dim)",
        },
        accent: {
          DEFAULT: "var(--panel-2)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--panel)",
          foreground: "var(--text)",
        },
      },
      fontFamily: {
        mono: ["var(--font-mono)"],
        sans: ["var(--font-sans)"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.5", transform: "scale(0.85)" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulse: "pulse 1.6s ease-in-out infinite",
        blink: "blink 1s step-end infinite",
        fadeIn: "fadeIn 0.3s ease-out both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
