// Scroll scenes removed for clean, stable presentation without scroll-hijacking.

export const EASE = "power3.out";
export const SCRUB = 0.7;
export const TIERS = {};

export function riseIn(tl) { return tl; }
export function riseOut(tl) { return tl; }
export function imageReveal(tl) { return tl; }
export function parallax() { return null; }
export function scrubTimeline(gsap) { return gsap ? gsap.timeline() : null; }

export function mountScenes() {
  return {
    refresh() {},
    revert() {}
  };
}
