// PBR light/dark theme. Follows the viewer's device setting (prefers-color-scheme).
//
// The pages are written with dark Tailwind classes (bg-slate-950, text-amber-300, ...).
// Instead of adding a light class to every element, this script points each Tailwind
// color at a CSS variable and swaps the variable values in light mode:
//   - slate/gray flip (950 page bg -> slate-100, 900 cards -> white, 100 text -> 900, ...)
//   - accent colors flip too, with light text shades (300/400) pushed to 700 for contrast.
// Opacity modifiers (bg-slate-900/80), gradients and HTML built in JS all follow along.
//
// Load it right after the Tailwind CDN script (after any page tailwind.config block).
(function () {
  const S = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const P = {
    slate:   ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#020617'],
    gray:    ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827', '#030712'],
    red:     ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a'],
    orange:  ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12', '#431407'],
    amber:   ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03'],
    yellow:  ['#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12', '#422006'],
    lime:    ['#f7fee7', '#ecfccb', '#d9f99d', '#bef264', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f', '#3f6212', '#365314', '#1a2e05'],
    green:   ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16'],
    emerald: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b', '#022c22'],
    teal:    ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a', '#042f2e'],
    cyan:    ['#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#083344'],
    sky:     ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#082f49'],
    blue:    ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'],
    indigo:  ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b'],
    violet:  ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065'],
    purple:  ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87', '#3b0764'],
    pink:    ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843', '#500724'],
    rose:    ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337', '#4c0519'],
  };
  const NEUTRAL = new Set(['slate', 'gray']);
  // Light mode: class shade -> shade actually shown ('w' = white).
  const LIGHT_NEUTRAL = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 600, 500: 500, 600: 400, 700: 300, 800: 200, 900: 'w', 950: 100 };
  const LIGHT_ACCENT  = { 50: 950, 100: 900, 200: 800, 300: 700, 400: 700, 500: 600, 600: 600, 700: 300, 800: 200, 900: 100, 950: 50 };

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
  const hexOf = (fam, shade) => (shade === 'w' ? '#ffffff' : P[fam][S.indexOf(shade)]);

  const dark = ['--c-white: 255 255 255;'];
  const light = [`--c-white: ${rgb(P.slate[9])};`]; // text-white / hover:text-white -> slate-900
  const colors = { white: 'rgb(var(--c-white) / <alpha-value>)' };
  for (const fam of Object.keys(P)) {
    const map = NEUTRAL.has(fam) ? LIGHT_NEUTRAL : LIGHT_ACCENT;
    colors[fam] = {};
    for (const s of S) {
      colors[fam][s] = `rgb(var(--c-${fam}-${s}) / <alpha-value>)`;
      dark.push(`--c-${fam}-${s}: ${rgb(hexOf(fam, s))};`);
      light.push(`--c-${fam}-${s}: ${rgb(hexOf(fam, map[s]))};`);
    }
  }

  const style = document.createElement('style');
  style.id = 'pbr-theme';
  style.textContent = `
:root { color-scheme: dark; ${dark.join(' ')} }
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; ${light.join(' ')} }
  /* text-slate-950 only sits on bright accent buttons/badges: keep it dark */
  .text-slate-950, .hover\\:text-slate-950:hover { color: rgb(${rgb(P.slate[10])}) !important; }
  .shadow-xl, .shadow-2xl, .shadow-lg { --tw-shadow-color: rgb(15 23 42 / 0.08); }
}`;
  document.head.prepend(style);

  const tw = window.tailwind;
  if (!tw) return;
  const cfg = tw.config || {};
  cfg.theme = cfg.theme || {};
  cfg.theme.extend = cfg.theme.extend || {};
  cfg.theme.extend.colors = Object.assign({}, cfg.theme.extend.colors, colors);
  tw.config = cfg;
})();
