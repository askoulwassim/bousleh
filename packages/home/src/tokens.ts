/*
 * Bousleh tokens, from docs/design/home/Tokens.dc.html. Dark only. CSS custom properties are
 * `--bsl-<name>`; TypeScript reads `tokens.<group>.<name>`. The build writes tokensCss() into the page.
 */

export const tokens = {
  color: {
    bg: '#0B0809',
    'bg-2': '#110D0F',
    well: '#120E10',
    panel: '#171215',
    'panel-2': '#211A1E',
    warm: '#2E2228',
    line: '#2C2227',
    'line-2': '#3D2F36',
    ghost: '#5A4650',
    fg: '#F2EAED',
    muted: '#AE9EA5',
    dim: '#8C7B83',
    zero: '#74626A',
    'accent-fill': '#A3264C',
    accent: '#C93A63',
    'accent-hi': '#E8668C',
    'accent-deep': '#5A1A30',
    'accent-hover': '#B8305A',
    'link-hover': '#F28FAC',
    ink: '#FFF0F4',
    needs: '#E3B65C',
    moving: '#62C4BC',
    closed: '#7E8696',
    'tint-needs': 'rgba(227,182,92,.08)',
    'tint-needs-line': 'rgba(227,182,92,.45)',
    'tint-needs-hot': 'rgba(227,182,92,.18)',
    'tint-accent-line': 'rgba(201,58,99,.45)',
    'tint-moving-line': 'rgba(98,196,188,.45)',
    'tint-closed-line': 'rgba(126,134,150,.45)',
    glow: 'rgba(110,20,48,.42)',
  },
  font: {
    display: "'Bricolage Grotesque', system-ui, sans-serif",
    ui: 'Figtree, system-ui, sans-serif',
    mono: "'JetBrains Mono', ui-monospace, monospace",
    arabic: "'Noto Kufi Arabic', sans-serif",
  },
  radius: { sm: '6px', cell: '10px', card: '12px', phone: '14px', chip: '999px' },
  size: {
    control: '44px',
    'control-sm': '34px',
    launcher: '40px',
    chip: '24px',
    'chip-hit': '28px',
    rail: '76px',
    tabbar: '84px',
    'mobile-primary': '50px',
  },
  space: {
    2: '2px',
    4: '4px',
    6: '6px',
    8: '8px',
    10: '10px',
    12: '12px',
    14: '14px',
    16: '16px',
    20: '20px',
    24: '24px',
    28: '28px',
    32: '32px',
    40: '40px',
    48: '48px',
    56: '56px',
  },
  motion: { fast: '150ms', base: '250ms', ring: '600ms', pulse: '1.4s' },
  layout: { 'strata-label': '132px', 'strata-launch': '200px', 'max-width': '1364px', phone: '720px' },
} as const;

/** Every token as `--bsl-<name>: value;` lines. Colours keep their name; other groups are prefixed (`--bsl-radius-card`). */
export function tokenDeclarations(): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(tokens.color)) lines.push(`--bsl-${name}:${value};`);
  for (const group of ['font', 'radius', 'size', 'space', 'motion', 'layout'] as const) {
    for (const [name, value] of Object.entries(tokens[group])) lines.push(`--bsl-${group}-${name}:${value};`);
  }
  return lines.join('');
}

/**
 * The tokens as CSS. Home is dark only, so the same values are declared on :root and again for the
 * platform's dark-mode hooks (the system preference unless the page is forced light, and data-theme="dark").
 */
export function tokensCss(): string {
  const decls = tokenDeclarations();
  return [
    `:root{color-scheme:dark;${decls}}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decls}}}`,
    `:root[data-theme="dark"]{${decls}}`,
  ].join('\n');
}
