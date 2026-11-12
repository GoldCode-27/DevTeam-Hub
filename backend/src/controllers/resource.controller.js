import path from "node:path";
import * as resourceService from "../services/resourceService.js";
import {
  deleteLocalFile,
  generateSignedDownloadUrl,
} from "../utils/storage.js";
import AppError from "../utils/appError.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sends any error (sync or async) to Express's error handler: no try/catch in every handler. */
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/** Same as wrap, and also deletes the just-uploaded file if the request fails (no orphan files). */
const withUploadCleanup = (handler) =>
  wrap(async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      await deleteLocalFile(req.file?.path);
      throw err;
    }
  });

const fail = (details) => {
  throw new AppError("Validation failed", 422, "VALIDATION_ERROR", details);
};

const can = (user, ...slugs) =>
  slugs.some((slug) => user?.permissions?.includes(slug));

// Accepts a UUID (public_id) or a number; rejects anything strange before it reaches the database
const ID_PATTERN = /^[A-Za-z0-9-]{1,36}$/;
const getId = (req) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id))
    fail([{ field: "id", message: "Invalid resource id" }]);
  return id;
};

// "Docs, API" or ["Docs","API"] -> ["Docs","API"] (trimmed, no duplicates)
const parseTags = (value) => {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const unique = new Map();
  for (const raw of list) {
    const name = String(raw).trim();
    if (name && !unique.has(name.toLowerCase()))
      unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()];
};

const parseBoolean = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null; // invalid
};
// Http url checker  
const toHttpUrl = (value) => {
  try {
    const url = new URL(String(value));
    if (["http:", "https:"].includes(url.protocol) && url.href.length <= 2048)
      return url.href;
  } catch {
    /* falls through */
  }
  return null;
};

/**
 * Whitelist: only these fields can come from the client.
 * Anything else in req.body (file_url, download_count, uploaded_by, id, ...) is ignored,
 * which stops "mass assignment" attacks.
 */
const parseResourceFields = (body = {}, file, { partial = false } = {}) => {
  const errors = [];
  const out = {};

  if (body.title !== undefined || !partial) {
    const title = String(body.title ?? "").trim();
    if (!title) errors.push({ field: "title", message: "Title is required" });
    else if (title.length > 255)
      errors.push({ field: "title", message: "Max 255 characters" });
    else out.title = title;
  }

  if (body.description !== undefined) {
    const description = String(body.description).trim();
    if (description.length > 5000)
      errors.push({ field: "description", message: "Max 5000 characters" });
    else out.description = description;
  }

  const tags = parseTags(body.tags);
  if (tags !== undefined) {
    if (tags.length > 10)
      errors.push({ field: "tags", message: "Max 10 tags" });
    else if (tags.some((tag) => tag.length > 50))
      errors.push({ field: "tags", message: "Each tag max 50 characters" });
    else out.tags = tags.join(","); // API doc: tags are a comma-separated string
  }

  const isPublic = parseBoolean(body.is_public);
  if (isPublic === null)
    errors.push({ field: "is_public", message: "Must be true or false" });
  else if (isPublic !== undefined) out.is_public = isPublic;

  if (body.link_url !== undefined && body.link_url !== "") {
    const href = toHttpUrl(body.link_url);
    if (href) out.link_url = href;
    else
      errors.push({
        field: "link_url",
        message: "Must be a valid http(s) URL",
      });
  }

  if (file && out.link_url)
    errors.push({
      field: "file",
      message: "Send either a file or link_url, not both",
    });
  if (!partial && !file && !out.link_url)
    errors.push({ field: "file", message: "Provide a file or link_url" });

  if (errors.length) fail(errors);
  return out;
};
//የዝርዝር ፍለጋ ማጣሪያ መርማሪ (parseListQuery)

const parseListQuery = (query = {}) => {
  const out = {
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    per_page: Math.min(Math.max(parseInt(query.per_page, 10) || 20, 1), 100),
  };
  const q = query.q ? String(query.q).trim().slice(0, 100) : "";
  if (q) out.q = q;

  const tags = parseTags(query.tags) ?? [];
  if (tags.length) out.tags = tags.join(",");

  if (query.visibility !== undefined) {
    if (!["public", "private"].includes(query.visibility)) {
      fail([{ field: "visibility", message: 'Must be "public" or "private"' }]);
    }
    out.visibility = query.visibility;
  }
  return out;
};

// "System Guide" + "uploads/ab12.pdf" -> "System_Guide.pdf" (the extension must be kept, or the file will not open)
const buildDownloadName = (title, storedPath) => {
  const base =
    String(title ?? "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}\-_ ]+/gu, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "resource";
  const ext = path.extname(String(storedPath ?? "")).toLowerCase();
  return base + (/^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "");
};

// ---------------------------------------------------------------------------
// T20: List resources
// ---------------------------------------------------------------------------
export const listResources = wrap(async (req, res) => {
  res.json(await resourceService.listResources(parseListQuery(req.query)));
});

// ---------------------------------------------------------------------------
// T21: Add a resource
// ---------------------------------------------------------------------------
export const createResource = withUploadCleanup(async (req, res) => {
  const fields = parseResourceFields(req.body, req.file);
  const data = await resourceService.createResource({
    ...fields,
    file: req.file,
    user: req.user,
  });
  res.status(201).json(data);
});

// ---------------------------------------------------------------------------
// T22: Update a resource 
// ---------------------------------------------------------------------------
export const updateResource = withUploadCleanup(async (req, res) => {
  const id = getId(req);
  const fields = parseResourceFields(req.body, req.file, { partial: true });

  // 1. የይዘት ለውጥ (ርዕስ፣ መግለጫ፣ ታግ፣ ሊንክ ወይም አዲስ ፋይል) መኖሩን ማረጋገጫ
  const hasContentEdits =
    fields.title !== undefined ||
    fields.description !== undefined ||
    fields.tags !== undefined ||
    fields.link_url !== undefined ||
    Boolean(req.file);

  // ይዘት እየቀየረ ከሆነ፦ የግድ 'resource:update' ወይም 'user:manage' (አድሚን) ሊኖረው ይገባል!
  if (hasContentEdits && !can(req.user, "resource:update", "user:manage")) {
    throw new AppError(
      "Forbidden: missing resource:update permission",
      403,
      "FORBIDDEN",
    );
  }

  // 2. የ Public/Private (is_public) ለውጥ እየተደረገ ከሆነ፦
  // የግድ 'resource:toggle_visibility' ወይም 'user:manage' (አድሚን) ሊኖረው ይገባል!
  if (
    fields.is_public !== undefined &&
    !can(req.user, "resource:toggle_visibility", "user:manage")
  ) {
    throw new AppError(
      "Forbidden: missing resource:toggle_visibility permission",
      403,
      "FORBIDDEN",
    );
  }

  // ወደ ዳታቤዝ ሰርቪስ ይላካል
  res.json(
    await resourceService.updateResource(id, { ...fields, file: req.file }),
  );
});

// ---------------------------------------------------------------------------
// T23: Delete a resource
// ---------------------------------------------------------------------------
export const deleteResource = wrap(async (req, res) => {
  await resourceService.deleteResource(getId(req));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// T24: Download a resource (302 redirect)
// ---------------------------------------------------------------------------
export const downloadResource = wrap(async (req, res) => {
  const resource = await resourceService.getResourceForDownload(getId(req));

  // The redirect target carries a short-lived token: never let a browser or proxy cache it
  res.set("Cache-Control", "no-store");

  if (resource.file_type === "LINK") {
    // Re-check even stored links: only http(s) is ever redirected to
    const href = toHttpUrl(resource.file_url);
    if (!href)
      throw new AppError(
        "This resource has an invalid link",
        500,
        "INTERNAL_SERVER_ERROR",
      );
    return res.redirect(302, href);
  }

  const downloadName = buildDownloadName(resource.title, resource.file_url);
  return res.redirect(
    302,
    generateSignedDownloadUrl(resource.file_url, downloadName),
  );
});
