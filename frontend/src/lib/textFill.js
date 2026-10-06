// Text fill scroll animation removed for clean, stable static text rendering.

export function mountTextFill() {
  return {
    revert() {}
  };
}
