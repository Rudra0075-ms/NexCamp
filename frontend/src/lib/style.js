// Inline-style helpers.
//
// The interface is authored with CSS declaration strings so that the markup
// reads like the design it implements; s() turns one into a React style
// object, and hov() returns the props that apply a declaration block while
// an element is hovered (it works for HTML and SVG elements alike).

const CUSTOM_PROP = /^--/;

const camel = (prop) =>
  CUSTOM_PROP.test(prop) ? prop : prop.replace(/-([a-z])/g, (m, c) => c.toUpperCase());

const parse = (css) => {
  const out = {};
  String(css)
    .split(";")
    .forEach((decl) => {
      const i = decl.indexOf(":");
      if (i < 0) return;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (prop && value) out[camel(prop)] = value;
    });
  return out;
};

const cache = new Map();

export function s(css) {
  if (!css) return undefined;
  if (!cache.has(css)) cache.set(css, Object.freeze(parse(css)));
  return cache.get(css);
}

export function hov(css) {
  const decls = Object.entries(parse(css));
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget;
      if (!el.dataset.hovPrev) {
        el.dataset.hovPrev = JSON.stringify(
          decls.map(([prop]) => el.style.getPropertyValue(hyphen(prop)))
        );
      }
      decls.forEach(([prop, value]) => el.style.setProperty(hyphen(prop), value));
    },
    onMouseLeave: (e) => {
      const el = e.currentTarget;
      const prev = el.dataset.hovPrev ? JSON.parse(el.dataset.hovPrev) : null;
      decls.forEach(([prop], i) => {
        const was = prev ? prev[i] : "";
        if (was) el.style.setProperty(hyphen(prop), was);
        else el.style.removeProperty(hyphen(prop));
      });
      delete el.dataset.hovPrev;
    }
  };
}

const hyphen = (prop) =>
  CUSTOM_PROP.test(prop) ? prop : prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
