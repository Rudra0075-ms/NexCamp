import { ApiError } from "../utils/ApiError.js";

// Runs a schema (see ../validations) against one part of the request and
// replaces it with the cleaned values, so controllers never see raw input.
export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const { value, errors } = schema(req[source] ?? {});
    if (errors && Object.keys(errors).length) {
      return next(ApiError.badRequest("Validation failed", errors));
    }
    req[source] = value;
    next();
  };
}
