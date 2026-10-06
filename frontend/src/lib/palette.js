// Theme colours for code that cannot use CSS: WebGL scenes, canvas textures.
//
// Every value is read from the custom properties in styles/theme.css at the
// moment a scene is built, so the 3D campus and the page never disagree. The
// fallbacks below only apply when there is no document to read (or a token is
// missing) and mirror the Charcoal & Signal Orange values in theme.css.

const FALLBACK = {
  "--color-bg": "#151515",
  "--color-surface": "#1C1C1C",
  "--color-surface-2": "#242424",
  // the CSS divider is translucent (rgba), which three.js cannot take; scenes
  // get its solid equivalent on the charcoal ground
  "--color-divider": "#2E2E2E",
  "--color-text": "#E5E5E5",
  "--color-heading": "#FFFFFF",
  "--color-muted": "#8F8F8F",
  "--color-accent": "#FF7511",
  "--color-accent-100": "#2A1A0E",
  "--color-accent-900": "#FFEBDD",
  "--color-accent-2": "#B8C2CC",
  "--color-accent-2-300": "#3A4148",
  "--color-warn": "#F5C542",
  "--color-neutral-100": "#1C1C1C",
  "--color-neutral-200": "#242424",
  "--color-neutral-300": "#2E2E2E",
  "--color-neutral-400": "#404040",
  "--color-neutral-500": "#6B6B6B",
  "--color-neutral-600": "#8F8F8F",
  "--color-neutral-700": "#A8A8A8",
  "--color-neutral-800": "#CFCFCF",
  "--color-neutral-900": "#FFFFFF"
};

/** A token's value as a CSS colour string ("#FF7511"). */
export function token(name) {
  if (typeof document !== "undefined") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  }
  return FALLBACK[name] || "#000000";
}

/** A token's value as a 0xRRGGBB number, for three.js. */
export function hex(name) {
  const v = token(name);
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return parseInt((FALLBACK[name] || "#000000").slice(1), 16);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return parseInt(h, 16);
}

/**
 * The palette of the 3D and illustrated scenes: a dark ground, light
 * buildings, orange for high-priority items and steel for secondary ones.
 */
export function scenePalette() {
  return {
    ground: hex("--color-bg"),
    lawn: hex("--color-surface"),
    road: hex("--color-surface-2"),
    path: hex("--color-divider"),
    grid: hex("--color-divider"),
    gridSub: hex("--color-surface-2"),
    wall: hex("--color-neutral-900"),
    wall2: hex("--color-neutral-800"),
    trim: hex("--color-neutral-700"),
    stone: hex("--color-neutral-600"),
    dim: hex("--color-neutral-500"),
    dark: hex("--color-neutral-400"),
    deep: hex("--color-neutral-300"),
    glass: hex("--color-neutral-200"),
    ink: hex("--color-bg"),
    canopy: hex("--color-neutral-400"),
    canopy2: hex("--color-neutral-500"),
    lamp: hex("--color-accent-900"),
    high: hex("--color-accent"),
    highGlow: hex("--color-accent-100"),
    secondary: hex("--color-accent-2"),
    warn: hex("--color-warn"),
    text: hex("--color-text"),
    // lights: a cool key over a dark bounce, so walls read light on the ground
    sky: hex("--color-neutral-900"),
    bounce: hex("--color-bg"),
    key: hex("--color-neutral-900"),
    rim: hex("--color-accent-2")
  };
}
