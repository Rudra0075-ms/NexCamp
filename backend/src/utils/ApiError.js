export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (details) this.details = details;
  }

  static badRequest(message = "Invalid request", details) {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message);
  }

  static forbidden(message = "You are not allowed to do that") {
    return new ApiError(403, message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, message);
  }

  static conflict(message = "Already exists") {
    return new ApiError(409, message);
  }
}
