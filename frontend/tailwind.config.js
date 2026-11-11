/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Design v2 tokens (DESIGN_V2.md §3). The landing page uses paper/ink,
      // the app uses night/cream; amber = playhead + highlights, rust = record
      // button + primary CTAs (white text only on rust or darker).
      colors: {
        paper: { DEFAULT: '#F4EFE4', 2: '#EAE3D3', line: '#D9D0BD' },
        ink: { DEFAULT: '#1F2A22', 2: '#45503F', 3: '#5C6655' },
        night: { DEFAULT: '#121A15', 2: '#1A241D', 3: '#223027', line: '#2E3D33' },
        cream: '#F4EFE4',
        // `amber` keeps Tailwind's built-in amber-50…950 scale alongside it.
        amber: { DEFAULT: '#E8B04B' },
        rust: { DEFAULT: '#B5532A', link: '#9A4522' },
        // shadcn/ui primitive colors — mapped in index.css's :root onto the
        // tokens above, so Sheet/Select/Tabs/toast pick up the v2 look with no
        // structural change. The brief's `muted` text colour (#A9B0A0) is
        // `text-muted-foreground`; `bg-muted` stays shadcn's quiet surface.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
