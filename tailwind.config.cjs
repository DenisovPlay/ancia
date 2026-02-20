/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      colors: {
        ink: {
          900: "#050607",
          800: "#0d1117",
          700: "#131a23",
          600: "#1a2331",
        },
        copper: {
          200: "#ffe0cf",
          300: "#ffc09d",
          400: "#ff9d66",
          500: "#ee7f46",
          600: "#ca6331",
        },
        mint: {
          200: "#bdfceb",
          300: "#74f2d4",
          400: "#4de5bf",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.12), 0 14px 48px rgba(2, 8, 24, 0.5)",
        soft: "0 12px 26px rgba(4, 12, 28, 0.28)",
      },
      keyframes: {
        "rise-in": {
          "0%": { opacity: 0, transform: "translateY(18px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "rise-in": "rise-in 450ms ease-out both",
      },
    },
  },
  plugins: [],
};
