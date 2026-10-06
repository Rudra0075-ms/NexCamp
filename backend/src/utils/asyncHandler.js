// Forwards rejected promises to the central error middleware so controllers do
// not each need their own try/catch.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
