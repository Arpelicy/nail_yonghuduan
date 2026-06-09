import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./features/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:  ["DM Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", "ui-sans-serif", "system-ui", "sans-serif"],
        mono:  ["DM Mono", "ui-monospace", "monospace"],
        cinzel: ["Cinzel", "serif"],
      },
      colors: {
        orchid: {
          50:  "#FDF6F0",
          100: "#F5E6D8",
          200: "#EDD0B4",
          300: "#DFA882",
          400: "#D08B60",
          500: "#C97A4E",  // accent — 烤赤陶橙
          600: "#A85E35",  // accent-dark
        },
        plum: "#2D1A10",          // 墨色正文
        mist: "rgba(45,26,16,0.62)", // 次要文字
      },
      boxShadow: {
        soft:    "0 20px 60px rgba(180,100,50,0.14)",
        "soft-md":"0 8px 32px rgba(180,100,50,0.12)",
        "soft-sm":"0 2px 12px rgba(180,100,50,0.08)",
        glow:    "0 18px 40px rgba(201,122,78,0.28)",
        "glow-sm":"0 6px 20px rgba(201,122,78,0.22)",
      },
      transitionTimingFunction: {
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
        "out-expo":  "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in":  { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.95)" }, to: { opacity: "1", transform: "scale(1)" } },
        shimmer: {
          "0%":   { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
      },
      animation: {
        "fade-in":  "fade-in 180ms ease both",
        "slide-up": "slide-up 260ms cubic-bezier(0.25,1,0.5,1) both",
        "scale-in": "scale-in 240ms cubic-bezier(0.16,1,0.3,1) both",
        shimmer:    "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
