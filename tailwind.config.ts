import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: "class",
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/editor/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    // Overlay entry animation.
    //
    // Menus, popovers, the tooltip, the command palette and the quick switcher all declare
    // `animate-in fade-in-0 zoom-in-95` (plus `slide-in-from-top-2` on the two dialogs). Those are
    // `tailwindcss-animate` class names, and that plugin is not a dependency here — every one of
    // them generated nothing, so the overlays hard-cut into existence. Rather than add a dependency
    // for four utilities, the used subset is defined directly, with the duration set once at the
    // reference value: docs/BLOCK_UX_REFERENCE.md, "Motion" — "Only menus get an entry animation,
    // and only around 150ms."
    //
    // The `ease-out` curve matches the only other real motion in the product, the block gutter's
    // fade in src/app/styles/editor.css. Reduced-motion users are covered by the blanket
    // `animation-duration: 0.01ms` rule in globals.css.
    plugin(({ addBase, addUtilities }) => {
      addBase({
        "@keyframes enter": {
          from: {
            opacity: "var(--tw-enter-opacity, 1)",
            transform:
              "translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), 1)",
          },
        },
      });
      addUtilities({
        ".animate-in": {
          animationName: "enter",
          animationDuration: "150ms",
          animationTimingFunction: "ease-out",
          animationFillMode: "both",
          "--tw-enter-opacity": "initial",
          "--tw-enter-scale": "initial",
          "--tw-enter-translate-x": "initial",
          "--tw-enter-translate-y": "initial",
        },
        ".fade-in-0": { "--tw-enter-opacity": "0" },
        ".zoom-in-95": { "--tw-enter-scale": ".95" },
        ".slide-in-from-top-2": { "--tw-enter-translate-y": "-0.5rem" },
      });
    }),
  ],
} satisfies Config;
