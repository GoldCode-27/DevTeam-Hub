import crypto from "node:crypto";
import path from "node:path";
import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { getFileType, deleteLocalFile } from "../utils/storage.js";
// ማስተካከያ 1፡ Dev 1 የሰራውን logActivity ረዳት ፈንክሽን እዚህ እናመጣለን
import { logActivity } from "../utils/activityLogger.js";

import { getPagination } from "../utils/pagination.js"; 


// safeQuery እና poolን ከ db.js እናወጣለን
const { pool, safeQuery } = db;

const APP_URL = (process.env.APP_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);
const DEFAULT_TAG_COLOR = "#6366F1";

// ===========================================================================
// Core Infrastructure: Atomic Transaction Manager
// ===========================================================================

/**
 * Runs `workUnit` inside one database transaction: commit on success, rollback on
 * any error, and the connection is always returned to the pool.
 * If the database reports a deadlock (two transactions waiting for each other, which
 * MySQL itself recommends retrying), the whole unit is run again, up to 3 times.
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} workUnit
 * @returns {Promise<T>}
 */
async function withTransaction(workUnit) {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await workUnit(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {}); // never hide the original error
      if (err.code === "ER_LOCK_DEADLOCK" && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, 15 * attempt + Math.random() * 25),
        );
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

// ===========================================================================
// Domain Helpers & Data Mappers
// ===========================================================================

const toBool = (value) =>
  value === true || ["true", "1"].includes(String(value).toLowerCase());

// Public resources always carry PUBLIC. A private one never keeps PUBLIC, but
// keeps a stricter badge (INTERNAL / RESTRICTED) it already had.
const resolveBadge = (isPublic, currentBadge) => {
  if (isPublic) return "PUBLIC";
  return currentBadge && currentBadge !== "PUBLIC" ? currentBadge : "INTERNAL";
};

// Path stored in the database: relative to the project folder, with forward slashes
const toStoredPath = (file) =>
  path.relative(process.cwd(), file.path).replace(/\\/g, "/");

/**
 * Normalizes user input into a list of clean tag names.
 * Duplicates are removed ignoring upper/lower case ("Docs" and "docs" are the same tag);
 * the first spelling wins.
 * @param {string[]|string|null|undefined} raw
 * @returns {string[]}
 */
function sanitizeTagNames(raw) {
  if (!raw) return [];
  const entries = Array.isArray(raw) ? raw : String(raw).split(",");
  const unique = new Map();
  for (const entry of entries) {
    const name = String(entry).trim();
    if (
      name.length > 0 &&
      name.length <= 50 &&
      !unique.has(name.toLowerCase())
    ) {
      unique.set(name.toLowerCase(), name);
    }
  }
  return [...unique.values()];
}

/**
 * Makes the tags of a resource equal to `tagNames`, inside an existing transaction.
 *  - missing tags are created with INSERT IGNORE (never fails if another request created
 *    the same tag a moment earlier); names are inserted in alphabetical order so two
 *    requests can never wait for each other in a circle
 *  - only the DIFFERENCE is written: removed tags are deleted by exact key, added tags are
 *    inserted. (A blanket "DELETE ... WHERE resource_id = ?" locks an empty range for a new
 *    resource and makes parallel requests deadlock.)
 */
async function syncResourceTags(conn, resourceId, tagNames) {
  let wantedIds = [];
  if (tagNames.length > 0) {
    const ordered = [...tagNames].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    await conn.query("INSERT IGNORE INTO tags (name, color_hex) VALUES ?", [
      ordered.map((name) => [name, DEFAULT_TAG_COLOR]),
    ]);
    const [tagRows] = await conn.query(
      "SELECT id FROM tags WHERE name IN (?)",
      [tagNames],
    );
    wantedIds = tagRows.map((t) => t.id);
  }

  // a plain SELECT takes no locks
  const [currentRows] = await conn.query(
    "SELECT tag_id FROM resource_tags WHERE resource_id = ?",
    [resourceId],
  );
  const current = new Set(currentRows.map((row) => row.tag_id));
  const wanted = new Set(wantedIds);

  const toRemove = [...current].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !current.has(id));

  if (toRemove.length > 0) {
    await conn.query(
      "DELETE FROM resource_tags WHERE resource_id = ? AND tag_id IN (?)",
      [resourceId, toRemove],
    );
  }
  if (toAdd.length > 0) {
    await conn.query(
      "INSERT INTO resource_tags (resource_id, tag_id) VALUES ?",
      [toAdd.map((id) => [resourceId, id])],
    );
  }
}

/**
 * Loads the tags of many resources with ONE query.
 * @param {number[]} resourceIds
 * @returns {Promise<Map<number, Array<{id: number, name: string, color_hex: string}>>>}
 */
async function fetchTagsForResourceBatch(resourceIds) {
  const tagMap = new Map();
  if (!resourceIds.length) return tagMap;

  resourceIds.forEach((id) => tagMap.set(id, []));

  const [rows] = await pool.query(
    `SELECT rt.resource_id, t.id, t.name, COALESCE(t.color_hex, '${DEFAULT_TAG_COLOR}') AS color_hex
       FROM resource_tags rt
       INNER JOIN tags t ON rt.tag_id = t.id
      WHERE rt.resource_id IN (?)
      ORDER BY t.name ASC`,
    [resourceIds],
  );

  for (const row of rows) {
    tagMap
      .get(row.resource_id)
      ?.push({ id: row.id, name: row.name, color_hex: row.color_hex });
  }
  return tagMap;
}

const SELECT_RESOURCE = `
  SELECT r.id, r.public_id, r.title, r.description, r.file_type, r.file_url, r.file_size_bytes,
         r.is_public, r.security_badge, r.download_count, r.created_at,
         u.public_id AS uploader_public_id, u.username, u.first_name, u.last_name, u.avatar_url
    FROM resources r
    LEFT JOIN users u ON r.uploaded_by = u.id`;

// Uploaded files are private: clients get the download endpoint, never the internal disk path.
// Links keep their external URL.
const fileUrlFor = (row) =>
  row.file_type === "LINK"
    ? row.file_url
    : `${APP_URL}/api/resources/${row.public_id}/download`;

/** Database row -> API shape (one place, used by list, create and update). */
function toResourceDto(row, tags = []) {
  return {
    public_id: row.public_id,
    title: row.title,
    description: row.description,
    file_type: row.file_type,
    file_url: fileUrlFor(row),
    file_size_bytes:
      row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    is_public: Boolean(row.is_public),
    security_badge: row.security_badge,
    download_count: row.download_count,
    created_at: row.created_at,
    tags,
    uploaded_by: {
      public_id: row.uploader_public_id,
      username: row.username,
      first_name: row.first_name,
      last_name: row.last_name,
      avatar_url: row.avatar_url,
    },
  };
}

/** Reads one resource back from the database (so responses always show the real saved data). */
async function getResourceDto(publicId) {
  const rows = await safeQuery(
    `${SELECT_RESOURCE} WHERE r.public_id = ? LIMIT 1`,
    [publicId],
  );
  if (!rows||rows.length === 0)
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  const tagsByResourceId = await fetchTagsForResourceBatch([rows[0].id]);
  return toResourceDto(rows[0], tagsByResourceId.get(rows[0].id) ?? []);
}

async function findRow(publicId, conn = pool, { forUpdate = false } = {}) {
  const [rows] = await conn.query(
    `SELECT * FROM resources WHERE public_id = ? LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
    [publicId],
  );
  if (rows.length === 0)
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  return rows[0];
}
//buildListFilters (የፍለጋ ማጣሪያዎችን በብልሃት መገንቢያ)

function buildListFilters({ q, tags, visibility }) {
  const predicates = ["1=1"];
  const params = [];

  if (q) {
    const tokens = q
      .replace(/[+\-<>()~*"@]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length > 0 && tokens.every((t) => t.length >= 3)) {
      // FULLTEXT index idx_ft_resources (it only indexes words of 3+ letters)
      predicates.push(
        "MATCH(r.title, r.description) AGAINST (? IN BOOLEAN MODE)",
      );
      params.push(tokens.map((t) => `+${t}*`).join(" "));
    } else {
      // short searches: LIKE, with % and _ escaped so they mean themselves
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      predicates.push("(r.title LIKE ? OR r.description LIKE ?)");
      params.push(like, like);
    }
  }
//visibility ላይ የተመሰረተ ፍለጋ ማጣሪያ
  if (visibility === "public") {
    predicates.push("r.is_public = TRUE");
  } else if (visibility === "private" || visibility === "internal") {
    predicates.push("r.is_public = FALSE");
  }
//resource_tags እና tags ላይ የተመሰረተ ፍለጋ ማጣሪያ
  if (tags.length > 0) {
    // any of the selected tags
    predicates.push(`EXISTS (
      SELECT 1 FROM resource_tags rt
      INNER JOIN tags t ON rt.tag_id = t.id
      WHERE rt.resource_id = r.id AND t.name IN (?)
    )`);
    params.push(tags);
  }

  return { whereClause: predicates.join(" AND "), params };
}

// ===========================================================================
// T20: List Resources (በብሬስ { } ውስጥ ተስተካክሎ የቀረበ)
// ===========================================================================

export async function listResources({
  q,
  tags,
  visibility,
  page,
  per_page,
} = {}) {
  // 1. page እና per_pageን ለ getPagination እንሰጣለን
  const { page: pageNumber, limit, offset } = getPagination({ page, per_page }, 20, 100);

  const search = q ? String(q).trim().slice(0, 100) : "";

  // 2. የማጣሪያ ህግ መገንቢያ (q, tags, visibility በቀጥታ ይጠራሉ)
  const { whereClause, params } = buildListFilters({
    q: search,
    tags: sanitizeTagNames(tags),
    visibility,
  });

  // 3. ሦስቱ ገለልተኛ ጥያቄዎች በአንድ ላይ ይሰራሉ
  const [[countRows], [resources], [allAvailableTags]] = await Promise.all([
    // ሀ) የፋይሎች ብዛት
    pool.query(
      `SELECT COUNT(r.id) AS total FROM resources r WHERE ${whereClause}`,
      params,
    ),
    // ለ) ትክክለኛዎቹን ፋይሎች በ limit እና offset ገድቦ ማምጣት
    pool.query(
      `${SELECT_RESOURCE}
        WHERE ${whereClause}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    // ሐ) ያሉትን ታጎች በሙሉ ማምጣት
    pool.query("SELECT id, name, color_hex FROM tags ORDER BY name ASC"),
  ]);

  // 4. ታጎችን መጫን
  const tagsByResourceId = await fetchTagsForResourceBatch(
    resources.map((r) => r.id),
  );

  // 5. ውጤቱን መመለስ
  return {
    page: pageNumber,
    per_page: limit,
    total: countRows[0]?.total ?? 0,
    resources: resources.map((r) =>
      toResourceDto(r, tagsByResourceId.get(r.id) ?? []),
    ),
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
  const cleanTitle = String(title ?? "").trim();
  if (!cleanTitle) {
    throw new AppError("Resource title is required", 422, "VALIDATION_ERROR", [
      { field: "title", message: "Title is required" },
    ]);
  }
  if (!file && !link_url) {
    throw new AppError("Provide a file or link_url", 422, "VALIDATION_ERROR", [
      { field: "file", message: "Provide a file or link_url" },
    ]);
  }
  // No silent fallback to "user 1": the uploader must be the logged-in user
  if (!user?.id)
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");

  const publicId = crypto.randomUUID();
  const isPublic = toBool(is_public);
  const isLink = !file;

  try {
    await withTransaction(async (conn) => {
      const [insertResult] = await conn.query(
        `INSERT INTO resources
           (public_id, title, description, file_type, file_url, file_size_bytes, is_public, security_badge, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          cleanTitle,
          description ? String(description).trim() : null,
          isLink ? "LINK" : getFileType(path.extname(file.originalname)),
          isLink ? link_url : toStoredPath(file),
          isLink ? null : file.size, // a link has no file size
          isPublic,
          resolveBadge(isPublic, null),
          user.id,
        ],
      );
      await syncResourceTags(
        conn,
        insertResult.insertId,
        sanitizeTagNames(tags),
      );
    });

    // ማስተካከያ፡ ትራንዛክሽኑ ከተሳካ በኋላ ዳሽቦርዱ እንዲያየው Activity እንመዘግባለን
    await logActivity({
      actorId: user.id,
      type: "RESOURCE_ADDED",
      entityType: "RESOURCE",
      entityRef: publicId,
      summary: `uploaded resource "${cleanTitle}"`,
    });

  } catch (err) {
    // Compensating action: the transaction failed, so the uploaded file must not stay on disk
    if (file?.path) await deleteLocalFile(file.path);
    throw err;
  }

  return getResourceDto(publicId);
}

// ===========================================================================
// T22: Update Resource
// ===========================================================================

export async function updateResource(
  publicId,
  { title, description, tags, is_public, file, link_url } = {},
) {
  let fileToRemove = null;

  try {
    await withTransaction(async (conn) => {
      // FOR UPDATE locks the row, so two simultaneous updates cannot overlap
      const current = await findRow(publicId, conn, { forUpdate: true });
      const changes = {};

      if (title !== undefined) changes.title = String(title).trim();
      if (description !== undefined)
        changes.description = description ? String(description).trim() : null;

      if (is_public !== undefined) {
        const nextPublic = toBool(is_public);
        changes.is_public = nextPublic;
        changes.security_badge = resolveBadge(
          nextPublic,
          current.security_badge,
        );
      }

      if (file) {
        changes.file_type = getFileType(path.extname(file.originalname));
        changes.file_url = toStoredPath(file);
        changes.file_size_bytes = file.size;
      } else if (link_url) {
        changes.file_type = "LINK";
        changes.file_url = link_url;
        changes.file_size_bytes = null;
      }

      // The old stored file is replaced by a new file OR by a link: either way it must be deleted
      if ((file || link_url) && current.file_type !== "LINK")
        fileToRemove = current.file_url;

      const keys = Object.keys(changes);
      if (keys.length > 0) {
        const setSql = keys.map((col) => `${col} = ?`).join(", ");
        const values = [...Object.values(changes), current.id];
        await conn.query(`UPDATE resources SET ${setSql} WHERE id = ?`, values);
      }
      if (tags !== undefined)
        await syncResourceTags(conn, current.id, sanitizeTagNames(tags));
    });
  } catch (err) {
    // Compensating action: discard the newly uploaded file
    if (file?.path) await deleteLocalFile(file.path);
    throw err;
  }

  // Only after the database commit succeeded is the replaced file deleted
  if (fileToRemove) await deleteLocalFile(fileToRemove);

  return getResourceDto(publicId);
}

// ===========================================================================
// T23: Delete Resource
// ===========================================================================

export async function deleteResource(publicId) {
  const row = await findRow(publicId);

  // One statement is already atomic; resource_tags rows are removed by ON DELETE CASCADE
  await safeQuery("DELETE FROM resources WHERE id = ?", [row.id]);

  // Links have no file on disk
  if (row.file_type !== "LINK") await deleteLocalFile(row.file_url);
  return true;
}

// ===========================================================================
// T24: Get Download Info
// ===========================================================================

export async function getResourceForDownload(publicId) {
  const row = await findRow(publicId);

  // Atomic increment: the database adds 1 itself, so simultaneous downloads are never lost
  await safeQuery(
    "UPDATE resources SET download_count = download_count + 1 WHERE id = ?",
    [row.id],
  );

  return {
    id: row.id,
    public_id: row.public_id,
    title: row.title,
    file_url: row.file_url,
    file_type: row.file_type,
  };
}

// ===========================================================================
// Developer 3 (Admin Visibility Matrix) Shared Services
// ===========================================================================

export async function listResourceVisibility(page, per_page = {}) {
  const {
    page: pageNumber,
    limit: pageSize,
    offset,
  } = getPagination({ page, per_page: per_page || perPage }, 20, 100);
  // 2. መረጃዎችን በ limit እና offset ማምጣት
  const [[items], [countResult]] = await Promise.all([
    pool.query(
      `SELECT public_id AS id, 'resource' AS type, title, description, is_public, updated_at
         FROM resources ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      [pageSize, offset],
    ),
    pool.query("SELECT COUNT(*) AS total FROM resources"),
  ]);
  // 3. ውጤቱን መመለስ
  return {
    page: pageNumber,
    total: countResult[0]?.total ?? 0,
    items: items.map((item) => ({
      ...item,
      is_public: Boolean(item.is_public),
    })),
  };
}

// Bulk switch. A stricter badge (RESTRICTED) is never lost when going private.
export async function setAllResourcesVisibility(isPublic) {
  const makePublic = toBool(isPublic);
  const [result] = await pool.query(
    `UPDATE resources
        SET is_public = ?,
            security_badge = IF(?, 'PUBLIC', IF(security_badge = 'PUBLIC', 'INTERNAL', security_badge))`,
    [makePublic, makePublic],
  );
  return { updated: result.affectedRows };
}
