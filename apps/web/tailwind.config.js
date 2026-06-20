/** @type {import('tailwindcss').Config} */
// Tokens mirror the Stitch "Editorial Minimalism" design system (DESIGN.md).
// Colors are CSS variables (RGB triples) defined in globals.css for :root (light)
// and .dark, so every `bg-*`/`text-*` token adapts to the active theme.
const tokenColor = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const COLOR_TOKENS = [
  "error-container", "on-primary-container", "on-tertiary", "secondary-fixed-dim",
  "on-secondary", "on-primary-fixed-variant", "surface-bright", "surface-dim",
  "secondary", "on-secondary-fixed", "tertiary-container", "error",
  "on-surface-variant", "surface-container-lowest", "surface-tint", "secondary-fixed",
  "inverse-surface", "surface", "tertiary-fixed-dim", "secondary-container",
  "on-error-container", "on-primary", "primary-fixed", "on-primary-fixed",
  "tertiary-fixed", "surface-container-low", "surface-container-highest",
  "on-tertiary-container", "primary-container", "surface-container", "tertiary",
  "on-secondary-container", "primary", "outline", "on-error", "on-background",
  "background", "primary-fixed-dim", "inverse-on-surface", "on-surface",
  "surface-container-high", "surface-variant", "inverse-primary",
  "on-secondary-fixed-variant", "outline-variant", "on-tertiary-fixed",
  "on-tertiary-fixed-variant",
];

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(COLOR_TOKENS.map((t) => [t, tokenColor(t)])),
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      spacing: {
        base: "4px",
        "max-width": "1200px",
        "stack-sm": "8px",
        gutter: "24px",
        "margin-desktop": "64px",
        "margin-mobile": "20px",
        "stack-md": "16px",
        "stack-lg": "32px",
      },
      maxWidth: {
        "max-width": "1200px",
      },
      fontFamily: {
        "body-lg": ["Hanken Grotesk", "system-ui", "sans-serif"],
        "label-caps": ["Hanken Grotesk", "system-ui", "sans-serif"],
        "headline-md": ["Playfair Display", "Georgia", "serif"],
        "body-sm": ["Hanken Grotesk", "system-ui", "sans-serif"],
        "data-mono": ["JetBrains Mono", "ui-monospace", "monospace"],
        "display-lg": ["Playfair Display", "Georgia", "serif"],
        "body-md": ["Hanken Grotesk", "system-ui", "sans-serif"],
        "headline-sm": ["Playfair Display", "Georgia", "serif"],
        "display-lg-mobile": ["Playfair Display", "Georgia", "serif"],
        // Reading serif for long-form article bodies (premium publishing feel).
        "reading": ["Source Serif 4", "Georgia", "Cambria", "serif"],
      },
      fontSize: {
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "1", letterSpacing: "0.05em", fontWeight: "700" }],
        "headline-md": ["32px", { lineHeight: "1.2", fontWeight: "600" }],
        "body-sm": ["14px", { lineHeight: "1.4", fontWeight: "400" }],
        "data-mono": ["14px", { lineHeight: "1.5", letterSpacing: "-0.01em", fontWeight: "500" }],
        "display-lg": ["48px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "body-md": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
        "headline-sm": ["24px", { lineHeight: "1.3", fontWeight: "600" }],
        "display-lg-mobile": ["32px", { lineHeight: "1.2", fontWeight: "700" }],
        // Comfortable long-form reading size.
        "reading": ["19px", { lineHeight: "1.8", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
};
