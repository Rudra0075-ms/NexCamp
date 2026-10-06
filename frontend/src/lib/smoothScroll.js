// Smooth scrolling removed — standard native scrolling used for stability and speed.

export function startSmoothScroll() {
  return null;
}

export function stopSmoothScroll() {}

export const pauseSmoothScroll = () => {};
export const resumeSmoothScroll = () => {};

export function scrollToY(top) {
  if (typeof window !== "undefined") {
    window.scrollTo({ top, left: 0, behavior: "instant" });
  }
}

