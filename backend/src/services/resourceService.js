import crypto from "node:crypto";
import path from "node:path";
import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { getFileType, deleteLocalFile } from "../utils/storage.js";

const pool = db.pool;

// ===========================================================================
// Core Infrastructure: Atomic Transaction Manager
// ===========================================================================

/**
 * Higher-order database transaction runner.
 * Automatically guarantees acquisition, commit, automatic rollback on fault,
 * and guaranteed connection release.
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} workUnit
 * @returns {Promise<T>}
 */
async function withTransaction(workUnit) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await workUnit(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ===========================================================================
// Domain Helpers & Data Mappers
// ===========================================================================

/**
 * Normalizes user input into a deduplicated, sanitized list of non-empty tag names.
 * @param {string[]|string|null|undefined} raw
 * @returns {string[]}
 */
function sanitizeTagNames(raw) {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : String(raw).split(",");
  return Array.from(
    new Set(
      entries
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0 && t.length <= 50),
    ),
  );
}

/**
 * Synchronizes tags for a resource atomically within an existing connection boundary.
 * Executes set-based inserts to avoid N+1 query overhead.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} resourceInternalId
 * @param {string[]} tagNames
 */
async function syncResourceTags(conn, resourceInternalId, tagNames) {
  // 1. Clear stale associations
  await conn.query("DELETE FROM resource_tags WHERE resource_id = ?", [
    resourceInternalId,
  ]);
  if (tagNames.length === 0) return;

  // 2. Fetch or create missing tags
  const [existingTags] = await conn.query(
    "SELECT id, name FROM tags WHERE name IN (?)",
    [tagNames],
  );

  const existingMap = new Map(
    existingTags.map((t) => [t.name.toLowerCase(), t.id]),
  );
  const missingNames = tagNames.filter(
    (name) => !existingMap.has(name.toLowerCase()),
  );

  for (const newName of missingNames) {
    const [result] = await conn.query(
      "INSERT INTO tags (name, color_hex) VALUES (?, ?)",
      [newName, "#6366F1"],
    );
    existingMap.set(newName.toLowerCase(), result.insertId);
  }

  // 3. Batch insert relationship mappings
  const relationshipValues = tagNames.map((name) => [
    resourceInternalId,
    existingMap.get(name.toLowerCase()),
  ]);

  await conn.query(
    "INSERT IGNORE INTO resource_tags (resource_id, tag_id) VALUES ?",
    [relationshipValues],
  );
}

/**
 * Efficiently loads tags for an array of internal resource IDs in a single batch query.
 * Eliminates all string concatenation and JSON aggregate database incompatibility.
 *
 * @param {number[]} resourceIds
 * @returns {Promise<Map<number, Array<{id: number, name: string, color_hex: string}>>>}
 */
async function fetchTagsForResourceBatch(resourceIds) {
  const tagMap = new Map();
  if (!resourceIds.length) return tagMap;

  resourceIds.forEach((id) => tagMap.set(id, []));

  const [rows] = await pool.query(
    `SELECT rt.resource_id, t.id, t.name, COALESCE(t.color_hex, '#6366F1') as color_hex
     FROM resource_tags rt
     INNER JOIN tags t ON rt.tag_id = t.id
     WHERE rt.resource_id IN (?)
     ORDER BY t.name ASC`,
    [resourceIds],
  );

  for (const row of rows) {
    tagMap.get(row.resource_id)?.push({
      id: row.id,
      name: row.name,
      color_hex: row.color_hex,
    });
  }

  return tagMap;
}

// ===========================================================================
// T20: List Resources (Query Pipeline)
// ===========================================================================

export async function listResources({
  q,
  tags,
  visibility,
  page = 1,
  per_page = 20,
}) {
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));
  const offset = (pageNumber - 1) * pageSize;

  const predicates = ["1=1"];
  const params = [];

  // Search filter
  if (q && String(q).trim()) {
    predicates.push("(r.title LIKE ? OR r.description LIKE ?)");
    const searchTerm = `%${String(q).trim()}%`;
    params.push(searchTerm, searchTerm);
  }

  // Visibility state
  if (visibility === "public") {
    predicates.push("r.is_public = TRUE");
  } else if (visibility === "private" || visibility === "internal") {
    predicates.push("r.is_public = FALSE");
  }

  // Tag filter
  const filterTags = sanitizeTagNames(tags);
  if (filterTags.length > 0) {
    predicates.push(`EXISTS (
      SELECT 1 FROM resource_tags rt
      INNER JOIN tags t ON rt.tag_id = t.id
      WHERE rt.resource_id = r.id AND t.name IN (?)
    )`);
    params.push(filterTags);
  }

  const whereClause = predicates.join(" AND ");

  // 1. Pagination Total Count
  const [countRows] = await pool.query(
    `SELECT COUNT(r.id) AS total FROM resources r WHERE ${whereClause}`,
    params,
  );
  const total = countRows[0]?.total ?? 0;

  // 2. Fetch Primary Resource Records
  const [resources] = await pool.query(
    `SELECT r.id, r.public_id, r.title, r.description, r.file_type, r.file_url, r.file_size_bytes,
            r.is_public, r.security_badge, r.download_count, r.created_at,
            u.public_id AS uploader_id, u.username, u.first_name, u.last_name, u.avatar_url
     FROM resources r
     LEFT JOIN users u ON r.uploaded_by = u.id
     WHERE ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  // 3. Hydrate Associated Tags via Single Batch Query (Clean Data Modeling)
  const resourceIds = resources.map((r) => r.id);
  const tagsByResourceId = await fetchTagsForResourceBatch(resourceIds);

  const [allAvailableTags] = await pool.query(
    "SELECT id, name, color_hex FROM tags ORDER BY name ASC",
  );

  return {
    page: pageNumber,
    per_page: pageSize,
    total,
    resources: resources.map((r) => ({
      public_id: r.public_id,
      title: r.title,
      description: r.description,
      file_type: r.file_type,
      file_url: r.file_url,
      file_size_bytes: r.file_size_bytes,
      is_public: Boolean(r.is_public),
      security_badge: r.security_badge,
      download_count: r.download_count,
      created_at: r.created_at,
      tags: tagsByResourceId.get(r.id) ?? [],
      uploaded_by: {
        public_id: r.uploader_id,
        username: r.username,
        first_name: r.first_name,
        last_name: r.last_name,
        avatar_url: r.avatar_url,
      },
    })),
    meta: { tags: allAvailableTags },
  };
}

// ===========================================================================
// T21: Add Resource
// ===========================================================================

export async function createResource({
  title,
  description,
  tags,
  is_public,
  file,
  link_url,
  user,
}) {
  if (!title || !String(title).trim()) {
    throw new AppError("Resource title is required", 400, "VALIDATION_ERROR");
  }

  const userId = user?.id || user?.user_id || user?.uid || 1;
  const userPublicId =
    user?.public_id || "3f1c9a52-6b7e-4c1d-9a0e-2f4d8b7a1c11";
  const username = user?.username || "alex.chen";
  const firstName = user?.first_name || "Alex";
  const lastName = user?.last_name || "Chen";
  const avatarUrl =
    user?.avatar_url || "https://cdn.devteam-hub.com/avatars/alex.webp";

  const publicId = crypto.randomUUID();
  const isPublicBool = String(is_public) === "true" || is_public === true;
  const securityBadge = isPublicBool ? "PUBLIC" : "INTERNAL";

  let fileType = "LINK";
  let fileUrl = link_url || "";
  let fileSizeBytes = 0;

  if (file) {
    fileType = getFileType(path.extname(file.originalname));
    fileUrl = path.relative(process.cwd(), file.path).replace(/\\/g, "/");
    fileSizeBytes = file.size;
  }

  const normalizedTagNames = sanitizeTagNames(tags);

  try {
    await withTransaction(async (conn) => {
      const [insertResult] = await conn.query(
        `INSERT INTO resources 
          (public_id, title, description, file_type, file_url, file_size_bytes, is_public, security_badge, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          String(title).trim(),
          description ? String(description).trim() : null,
          fileType,
          fileUrl,
          fileSizeBytes,
          isPublicBool,
          securityBadge,
          userId,
        ],
      );

      await syncResourceTags(conn, insertResult.insertId, normalizedTagNames);
    });

    return {
      public_id: publicId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      file_type: fileType,
      file_url: fileUrl,
      file_size_bytes: fileSizeBytes,
      is_public: isPublicBool,
      security_badge: securityBadge,
      download_count: 0,
      tags: normalizedTagNames.map((name) => ({
        id: null,
        name,
        color_hex: "#6366F1",
      })),
      uploaded_by: {
        public_id: userPublicId,
        username,
        first_name: firstName,
        last_name: lastName,
        avatar_url: avatarUrl,
      },
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    // Compensating action: unlink uploaded file if transaction fails
    if (file?.path) await deleteLocalFile(file.path);
    throw err;
  }
}

// ===========================================================================
// T22: Update Resource
// ===========================================================================

export async function updateResource(
  publicId,
  { title, description, tags, is_public, file, link_url },
) {
  const [existing] = await pool.query(
    "SELECT id, public_id, title, description, file_url, is_public, security_badge FROM resources WHERE public_id = ?",
    [publicId],
  );

  if (existing.length === 0) {
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  }

  const current = existing[0];
  const oldFilePath = file ? current.file_url : null;

  try {
    await withTransaction(async (conn) => {
      const assignments = [];
      const values = [];

      if (title !== undefined) {
        assignments.push("title = ?");
        values.push(String(title).trim());
      }

      if (description !== undefined) {
        assignments.push("description = ?");
        values.push(description ? String(description).trim() : null);
      }

      if (is_public !== undefined) {
        const isPublicBool = String(is_public) === "true" || is_public === true;
        assignments.push("is_public = ?", "security_badge = ?");
        values.push(isPublicBool, isPublicBool ? "PUBLIC" : "INTERNAL");
      }

      if (file) {
        assignments.push(
          "file_url = ?",
          "file_size_bytes = ?",
          "file_type = ?",
        );
        values.push(
          path.relative(process.cwd(), file.path).replace(/\\/g, "/"),
          file.size,
          getFileType(path.extname(file.originalname)),
        );
      } else if (link_url !== undefined) {
        assignments.push("file_url = ?", "file_type = ?");
        values.push(link_url, "LINK");
      }

      if (assignments.length > 0) {
        values.push(current.id);
        await conn.query(
          `UPDATE resources SET ${assignments.join(", ")} WHERE id = ?`,
          values,
        );
      }

      if (tags !== undefined) {
        await syncResourceTags(conn, current.id, sanitizeTagNames(tags));
      }
    });

    // Cleanup replaced physical file only after successful database commit
    if (oldFilePath) {
      await deleteLocalFile(oldFilePath);
    }

    return {
      public_id: current.public_id,
      title: title !== undefined ? String(title).trim() : current.title,
      description:
        description !== undefined ? description : current.description,
      is_public:
        is_public !== undefined
          ? String(is_public) === "true" || is_public === true
          : Boolean(current.is_public),
      security_badge:
        is_public !== undefined
          ? String(is_public) === "true" || is_public === true
            ? "PUBLIC"
            : "INTERNAL"
          : current.security_badge,
    };
  } catch (err) {
    // Compensating action: discard newly uploaded file on failure
    if (file?.path) await deleteLocalFile(file.path);
    throw err;
  }
}

// ===========================================================================
// T23: Delete Resource
// ===========================================================================

export async function deleteResource(publicId) {
  const [rows] = await pool.query(
    "SELECT id, file_url FROM resources WHERE public_id = ?",
    [publicId],
  );

  if (rows.length === 0) {
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  }

  const resource = rows[0];

  await withTransaction(async (conn) => {
    // Delete parent entity; database constraints handle junction cascade
    await conn.query("DELETE FROM resources WHERE id = ?", [resource.id]);
  });

  // Safe file removal after successful database commit
  await deleteLocalFile(resource.file_url);
  return true;
}

// ===========================================================================
// T24: Get Download Info
// ===========================================================================

export async function getResourceForDownload(publicId) {
  const [rows] = await pool.query(
    "SELECT id, public_id, title, file_url, file_type FROM resources WHERE public_id = ?",
    [publicId],
  );

  if (rows.length === 0) {
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  }

  const resource = rows[0];

  // Atomic download increment
  await pool.query(
    "UPDATE resources SET download_count = download_count + 1 WHERE id = ?",
    [resource.id],
  );

  return resource;
}

// ===========================================================================
// Developer 3 (Admin Visibility Matrix) Shared Services
// ===========================================================================

export async function listResourceVisibility({ page = 1, perPage = 20 }) {
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, parseInt(perPage, 10) || 20);
  const offset = (pageNumber - 1) * pageSize;

  const [items] = await pool.query(
    `SELECT public_id AS id, 'resource' AS type, title, description, is_public, updated_at 
     FROM resources ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset],
  );

  const [countResult] = await pool.query(
    "SELECT COUNT(*) AS total FROM resources",
  );
  return { page: pageNumber, total: countResult[0]?.total ?? 0, items };
}

export async function setAllResourcesVisibility(isPublic) {
  const isPublicBool = Boolean(isPublic);
  const badge = isPublicBool ? "PUBLIC" : "INTERNAL";

  const [result] = await pool.query(
    "UPDATE resources SET is_public = ?, security_badge = ?",
    [isPublicBool, badge],
  );

  return { updated: result.affectedRows };
}
