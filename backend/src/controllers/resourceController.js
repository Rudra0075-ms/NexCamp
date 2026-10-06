import { Resource } from "../models/Resource.js";
import { evaluateResource } from "../services/resourceModerationService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/respond.js";

export const listResources = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing & Help.");
  }

  const { search, category, officialOnly, myOnly, type } = req.query;

  const query = {};

  // Role visibility: Students see all APPROVED resources + their own submissions.
  // Admins see all resources.
  if (req.user.role === "STUDENT") {
    query.$or = [{ status: "APPROVED" }, { author: req.user._id }];
  }

  if (category && category !== "ALL") {
    query.category = category.toUpperCase();
  }

  if (type && type !== "ALL") {
    query.resourceType = type.toUpperCase();
  }

  if (officialOnly === "true") {
    query.isOfficial = true;
  }

  if (myOnly === "true") {
    query.author = req.user._id;
  }

  if (search && search.trim()) {
    const s = search.trim();
    const regex = new RegExp(s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"), "i");
    const searchFilter = {
      $or: [
        { title: regex },
        { description: regex },
        { tags: regex },
        { authorName: regex },
        { attachmentName: regex }
      ]
    };

    if (query.$or) {
      query.$and = [{ $or: query.$or }, searchFilter];
      delete query.$or;
    } else {
      Object.assign(query, searchFilter);
    }
  }

  const resources = await Resource.find(query)
    .sort({ isOfficial: -1, createdAt: -1 })
    .populate("author", "name email role studentId");

  return ok(res, {
    resources,
    totalCount: resources.length,
    viewerRole: req.user.role
  });
});

export const getResource = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing.");
  }

  const { id } = req.params;
  const resource = await Resource.findById(id).populate("author", "name email role studentId");
  if (!resource) {
    throw ApiError.notFound("Resource not found");
  }

  resource.viewsCount = (resource.viewsCount || 0) + 1;
  await resource.save();

  return ok(res, resource);
});

export const createResource = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have permission to publish or access campus resources.");
  }

  const {
    title,
    description,
    category = "ACADEMIC",
    resourceType = "FILE",
    fileUrl = "",
    attachmentName = "",
    attachmentSize = "",
    linkUrl = "",
    tags = []
  } = req.body;

  if (!title || !description) {
    throw ApiError.badRequest("Title and description are required.");
  }

  const isOfficial = req.user.role === "ADMIN";

  if (isOfficial) {
    const resource = await Resource.create({
      title,
      description,
      category,
      resourceType,
      fileUrl,
      attachmentName: attachmentName || (fileUrl ? "Campus_Document.pdf" : ""),
      attachmentSize: attachmentSize || (fileUrl ? "1.8 MB" : ""),
      linkUrl,
      author: req.user._id,
      authorName: req.user.name || "Campus Administration",
      authorRole: "ADMIN",
      isOfficial: true,
      status: "APPROVED",
      moderation: {
        method: "ADMIN_OFFICIAL_BROADCAST",
        isAppropriate: true,
        relevanceScore: 100,
        reasons: ["Verified and published by College Administration."]
      },
      tags: Array.isArray(tags) ? tags : []
    });

    return created(res, resource, "Official resource broadcasted successfully to campus feed.");
  }

  // Student submission -> Run realistic AI/Rule-based content moderation
  const moderation = await evaluateResource({
    title,
    description,
    category,
    tags: Array.isArray(tags) ? tags : [],
    linkUrl
  });

  const resource = await Resource.create({
    title,
    description,
    category,
    resourceType,
    fileUrl,
    attachmentName: attachmentName || (fileUrl ? "Student_Notes.pdf" : ""),
    attachmentSize: attachmentSize || (fileUrl ? "2.4 MB" : ""),
    linkUrl,
    author: req.user._id,
    authorName: req.user.name || "Student Contributor",
    authorRole: "STUDENT",
    isOfficial: false,
    status: moderation.status,
    moderation,
    tags: Array.isArray(tags) ? tags : []
  });

  if (moderation.status === "APPROVED") {
    return created(res, resource, "Resource verified by Campus AI Moderation and published successfully.");
  }

  return res.status(422).json({
    success: false,
    message: "Resource submission rejected by Campus AI Content Moderation.",
    reasons: moderation.reasons,
    data: resource
  });
});

export const updateResource = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing.");
  }

  const { id } = req.params;
  const resource = await Resource.findById(id);
  if (!resource) {
    throw ApiError.notFound("Resource not found");
  }

  const isAdmin = req.user.role === "ADMIN";
  const isAuthor = String(resource.author) === String(req.user._id);

  if (!isAdmin && !isAuthor) {
    throw ApiError.forbidden("You do not have permission to edit this resource.");
  }

  const { title, description, category, resourceType, fileUrl, linkUrl, tags } = req.body;

  if (title) resource.title = title;
  if (description) resource.description = description;
  if (category) resource.category = category;
  if (resourceType) resource.resourceType = resourceType;
  if (fileUrl !== undefined) resource.fileUrl = fileUrl;
  if (linkUrl !== undefined) resource.linkUrl = linkUrl;
  if (tags) resource.tags = Array.isArray(tags) ? tags : [];

  if (!isAdmin) {
    const moderation = await evaluateResource({
      title: resource.title,
      description: resource.description,
      category: resource.category,
      tags: resource.tags,
      linkUrl: resource.linkUrl
    });
    resource.moderation = moderation;
    resource.status = moderation.status;
  }

  await resource.save();

  return ok(res, resource, "Resource updated successfully.");
});

export const deleteResource = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing.");
  }

  const { id } = req.params;
  const resource = await Resource.findById(id);
  if (!resource) {
    throw ApiError.notFound("Resource not found");
  }

  const isAdmin = req.user.role === "ADMIN";
  const isAuthor = String(resource.author) === String(req.user._id);

  if (!isAdmin && !isAuthor) {
    throw ApiError.forbidden("You do not have permission to delete this resource.");
  }

  await Resource.findByIdAndDelete(id);

  return ok(res, { id }, "Resource deleted successfully.");
});

export const trackDownload = asyncHandler(async (req, res) => {
  if (req.user?.role === "WARDEN") {
    throw ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing.");
  }

  const { id } = req.params;
  const resource = await Resource.findById(id);
  if (!resource) {
    throw ApiError.notFound("Resource not found");
  }

  resource.downloadsCount = (resource.downloadsCount || 0) + 1;
  await resource.save();

  return ok(res, { downloadsCount: resource.downloadsCount });
});
