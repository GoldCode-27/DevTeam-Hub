import db from "../config/db.js";
import { getFileType } from "../utils/storage.js";

const pool = db.pool;

// In-memory cache for 30 seconds
let memoryCache = { data: null, expiresAt: 0 };

export const getPublicWorkspace = async (req, res, next) => {
  try {
    const { sections = "resources,tasks,team", q, tags } = req.query;
    const requested = sections.split(",").map((s) => s.trim().toLowerCase());

    const isSimpleRequest = !q && !tags;
    const now = Date.now();

    // Serve from cache if active and no search filters applied
    if (isSimpleRequest && memoryCache.data && memoryCache.expiresAt > now) {
      return res.status(200).json(memoryCache.data);
    }

    const response = {};

    // 1. PUBLIC RESOURCES
    if (requested.includes("resources")) {
      let conditions = ["r.is_public = TRUE"];
      let params = [];

      if (q) {
        conditions.push("(r.title LIKE ? OR r.description LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }

      const [resources] = await pool.query(
        `SELECT r.public_id, r.title, r.description, r.file_type, r.file_url, r.file_size_bytes,
                r.is_public, r.security_badge, r.download_count, r.created_at,
                u.first_name, u.last_name, u.avatar_url,
                COALESCE(
                  JSON_ARRAYAGG(
                    IF(t.id IS NOT NULL, JSON_OBJECT('id', t.id, 'name', t.name, 'color_hex', t.color_hex), NULL)
                  ), JSON_ARRAY()
                ) AS tags
         FROM resources r
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN resource_tags rt ON r.id = rt.resource_id
         LEFT JOIN tags t ON rt.tag_id = t.id
         WHERE ${conditions.join(" AND ")}
         GROUP BY r.id
         ORDER BY r.created_at DESC
         LIMIT 20`,
        params,
      );

      response.resources = resources.map((res) => ({
        public_id: res.public_id,
        title: res.title,
        description: res.description,
        file_type: res.file_type,
        file_url: res.file_url,
        file_size_bytes: res.file_size_bytes,
        is_public: true,
        security_badge: "PUBLIC",
        download_count: res.download_count,
        created_at: res.created_at,
        tags: (typeof res.tags === "string"
          ? JSON.parse(res.tags)
          : res.tags
        ).filter(Boolean),
        uploaded_by: {
          first_name: res.first_name,
          last_name: res.last_name,
          avatar_url: res.avatar_url,
        },
      }));
    }

    // 2. PUBLIC TASKS (Grouped by status for Kanban preview)
    if (requested.includes("tasks")) {
      const [tasks] = await pool.query(
        `SELECT task_code, title, status, priority, position
         FROM tasks
         WHERE is_public = TRUE
         ORDER BY position ASC`,
      );

      response.tasks = {
        UNDONE: tasks.filter((t) => t.status === "UNDONE"),
        IN_PROGRESS: tasks.filter((t) => t.status === "IN_PROGRESS"),
        COMPLETED: tasks.filter((t) => t.status === "COMPLETED"),
      };
    }

    // 3. MEET THE TEAM (Active developers only, strictly NO EMAILS)
    if (requested.includes("team")) {
      const [members] = await pool.query(
        `SELECT first_name, last_name, job_title, bio, avatar_url, last_active_at
         FROM users
         WHERE status = 'ACTIVE'
         ORDER BY first_name ASC`,
      );

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const formatted = members.map((m) => ({
        first_name: m.first_name,
        last_name: m.last_name,
        job_title: m.job_title,
        bio: m.bio,
        avatar_url: m.avatar_url,
        presence:
          new Date(m.last_active_at) > twoMinutesAgo ? "online" : "away",
      }));

      response.team = {
        total: formatted.length,
        online: formatted.filter((m) => m.presence === "online").length,
        members: formatted,
      };
    }

    // Cache the clean result for 30 seconds
    if (isSimpleRequest) {
      memoryCache = { data: response, expiresAt: now + 30 * 1000 };
    }

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
};
