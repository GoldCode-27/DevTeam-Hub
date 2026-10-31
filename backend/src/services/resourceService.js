import pool from "../config/db.js";
import crypto from "crypto";
import path from "path";
import AppError from "../utils/appError.js";
import { getFileType, deleteLocalFile } from "../utils/storage.js";

// Helper: Synchronize tags (insert if new, then associate in resource_tags)
async function syncResourceTags(conn, resourceId, tagsInput) {
  if (tagsInput === undefined || tagsInput === null) return;

  const tagNames = Array.isArray(tagsInput)
    ? tagsInput
    : String(tagsInput)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

  // Clear existing mappings for this resource
  await conn.query("DELETE FROM resource_tags WHERE resource_id = ?", [
    resourceId,
  ]);
  if (tagNames.length === 0) return;

  for (const name of tagNames) {
    let [rows] = await conn.query("SELECT id FROM tags WHERE name = ?", [name]);
    let tagId;
    if (rows.length === 0) {
      const [insertResult] = await conn.query(
        "INSERT INTO tags (name, color_hex) VALUES (?, ?)",
        [name, "#6366F1"],
      );
      tagId = insertResult.insertId;
    } else {
      tagId = rows[0].id;
    }
    await conn.query(
      "INSERT IGNORE INTO resource_tags (resource_id, tag_id) VALUES (?, ?)",
      [resourceId, tagId],
    );
  }
}

// ==========================================
// T20: List resources
// ==========================================
export async function listResources({
  q,
  tags,
  visibility,
  page = 1,
  per_page = 20,
}) {
  const p = Math.max(1, parseInt(page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(per_page, 10)));
  const offset = (p - 1) * limit;

  const conditions = ["1=1"];
  const params = [];

  if (q) {
    conditions.push("(r.title LIKE ? OR r.description LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  if (visibility === "public") {
    conditions.push("r.is_public = TRUE");
  } else if (visibility === "private" || visibility === "internal") {
    conditions.push("r.is_public = FALSE");
  }

  if (tags) {
    const tagArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagArray.length > 0) {
      conditions.push(`r.id IN (
        SELECT rt.resource_id FROM resource_tags rt
        JOIN tags t ON rt.tag_id = t.id
        WHERE t.name IN (?)
      )`);
      params.push(tagArray);
    }
  }

  const whereSql = conditions.join(" AND ");

  const [countResult] = await pool.query(
    `SELECT COUNT(DISTINCT r.id) as total FROM resources r WHERE ${whereSql}`,
    params,
  );
  const total = countResult[0].total;

  const [rows] = await pool.query(
    `SELECT r.id, r.public_id, r.title, r.description, r.file_type, r.file_url, r.file_size_bytes,
            r.is_public, r.security_badge, r.download_count, r.created_at,
            u.public_id AS uploader_id, u.username, u.first_name, u.last_name, u.avatar_url,
            COALESCE(
              JSON_ARRAYAGG(
                IF(t.id IS NOT NULL, JSON_OBJECT('id', t.id, 'name', t.name, 'color_hex', t.color_hex), NULL)
              ), JSON_ARRAY()
            ) AS tags
     FROM resources r
     LEFT JOIN users u ON r.uploaded_by = u.id
     LEFT JOIN resource_tags rt ON r.id = rt.resource_id
     LEFT JOIN tags t ON rt.tag_id = t.id
     WHERE ${whereSql}
     GROUP BY r.id
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const [allTags] = await pool.query(
    "SELECT id, name, color_hex FROM tags ORDER BY name ASC",
  );

  const formattedResources = rows.map((item) => ({
    public_id: item.public_id,
    title: item.title,
    description: item.description,
    file_type: item.file_type,
    file_url: item.file_url,
    file_size_bytes: item.file_size_bytes,
    is_public: Boolean(item.is_public),
    security_badge: item.security_badge,
    download_count: item.download_count,
    created_at: item.created_at,
    tags: (typeof item.tags === "string"
      ? JSON.parse(item.tags)
      : item.tags
    ).filter(Boolean),
    uploaded_by: {
      public_id: item.uploader_id,
      username: item.username,
      first_name: item.first_name,
      last_name: item.last_name,
      avatar_url: item.avatar_url,
    },
  }));

  return {
    page: p,
    per_page: limit,
    total,
    resources: formattedResources,
    meta: { tags: allTags },
  };
}

// ==========================================
// T21: Add Resource
// ==========================================
export async function createResource({
  title,
  description,
  tags,
  is_public,
  file,
  link_url,
  user,
}) {
  if (!title) throw new AppError("Title is required", 400);

  const public_id = crypto.randomUUID();
  const isPublicBool = String(is_public) === "true" || is_public === true;
  const security_badge = isPublicBool ? "PUBLIC" : "INTERNAL";

  let file_type = "LINK";
  let file_url = link_url || "";
  let file_size_bytes = 0;

  if (file) {
    file_type = getFileType(path.extname(file.originalname));
    file_url = path.relative(process.cwd(), file.path).replace(/\\/g, "/");
    file_size_bytes = file.size;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [insertResult] = await conn.query(
      `INSERT INTO resources 
        (public_id, title, description, file_type, file_url, file_size_bytes, is_public, security_badge, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        public_id,
        title,
        description || null,
        file_type,
        file_url,
        file_size_bytes,
        isPublicBool,
        security_badge,
        user.id,
      ],
    );

    const resourceId = insertResult.insertId;
    await syncResourceTags(conn, resourceId, tags);

    await conn.commit();

    return {
      public_id,
      title,
      description,
      file_type,
      file_url,
      file_size_bytes,
      is_public: isPublicBool,
      security_badge,
      download_count: 0,
      tags: tags
        ? Array.isArray(tags)
          ? tags
          : tags.split(",").map((t) => t.trim())
        : [],
      uploaded_by: {
        public_id: user.public_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
      },
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    await conn.rollback();
    if (file) deleteLocalFile(file.path);
    throw err;
  } finally {
    conn.release();
  }
}

// ==========================================
// T22: Update Resource
// ==========================================
export async function updateResource(
  publicId,
  { title, description, tags, is_public, file, link_url },
) {
  const [existing] = await pool.query(
    "SELECT * FROM resources WHERE public_id = ?",
    [publicId],
  );
  if (existing.length === 0)
    throw new AppError("Resource not found", 404, "NOT_FOUND");
  const resource = existing[0];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push("title = ?");
      values.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description);
    }
    if (is_public !== undefined) {
      const isPublicBool = String(is_public) === "true" || is_public === true;
      updates.push("is_public = ?", "security_badge = ?");
      values.push(isPublicBool, isPublicBool ? "PUBLIC" : "INTERNAL");
    }

    if (file) {
      deleteLocalFile(resource.file_url);
      updates.push("file_url = ?", "file_size_bytes = ?", "file_type = ?");
      values.push(
        path.relative(process.cwd(), file.path).replace(/\\/g, "/"),
        file.size,
        getFileType(path.extname(file.originalname)),
      );
    } else if (link_url !== undefined) {
      updates.push("file_url = ?", "file_type = ?");
      values.push(link_url, "LINK");
    }

    if (updates.length > 0) {
      values.push(resource.id);
      await conn.query(
        `UPDATE resources SET ${updates.join(", ")} WHERE id = ?`,
        values,
      );
    }

    if (tags !== undefined) {
      await syncResourceTags(conn, resource.id, tags);
    }

    await conn.commit();

    return {
      public_id: resource.public_id,
      title: title || resource.title,
      description:
        description !== undefined ? description : resource.description,
      is_public:
        is_public !== undefined
          ? String(is_public) === "true"
          : Boolean(resource.is_public),
      security_badge:
        is_public !== undefined
          ? String(is_public) === "true"
            ? "PUBLIC"
            : "INTERNAL"
          : resource.security_badge,
    };
  } catch (err) {
    await conn.rollback();
    if (file) deleteLocalFile(file.path);
    throw err;
  } finally {
    conn.release();
  }
}

// ==========================================
// T23: Delete Resource
// ==========================================
export async function deleteResource(publicId) {
  const [rows] = await pool.query(
    "SELECT id, file_url FROM resources WHERE public_id = ?",
    [publicId],
  );
  if (rows.length === 0)
    throw new AppError("Resource not found", 404, "NOT_FOUND");

  deleteLocalFile(rows[0].file_url);
  await pool.query("DELETE FROM resources WHERE id = ?", [rows[0].id]);
  return true;
}

// ==========================================
// T24: Get Download Info
// ==========================================
export async function getResourceForDownload(publicId) {
  const [rows] = await pool.query(
    "SELECT * FROM resources WHERE public_id = ?",
    [publicId],
  );
  if (rows.length === 0)
    throw new AppError("Resource not found", 404, "NOT_FOUND");

  const resource = rows[0];
  await pool.query(
    "UPDATE resources SET download_count = download_count + 1 WHERE id = ?",
    [resource.id],
  );
  return resource;
}

// ==========================================
// Helpers for Developer 3 (Admin Visibility Matrix)
// ==========================================
export async function listResourceVisibility({ page = 1, perPage = 20 }) {
  const p = Math.max(1, parseInt(page, 10));
  const limit = Math.max(1, parseInt(perPage, 10));
  const offset = (p - 1) * limit;

  const [items] = await pool.query(
    `SELECT public_id AS id, 'resource' AS type, title, description, is_public, updated_at 
     FROM resources ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const [countResult] = await pool.query(
    "SELECT COUNT(*) AS total FROM resources",
  );
  return { page: p, total: countResult[0].total, items };
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
