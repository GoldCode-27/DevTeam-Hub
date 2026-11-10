import db from "../config/db.js";
const pool = typeof db.query === "function" ? db : db.pool;

const APP_URL = (process.env.APP_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);
const ONLINE_SECONDS = 2 * 60; //   online: active within 2 minutes   (API doc)
const AWAY_SECONDS = 15 * 60; //    away:   active within 15 minutes  (API doc), otherwise offline
const MAX_TASKS = 200;
const MAX_TEAM_MEMBERS = 100;

// Words InnoDB does not index ("the", "with", "from" ...). Requiring one of them with "+" would
// make a search like "the guide" find nothing, so they are left out of the FULLTEXT query.
const FULLTEXT_STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "are",
  "as",
  "at",
  "be",
  "by",
  "com",
  "de",
  "en",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "la",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "und",
  "was",
  "what",
  "when",
  "where",
  "who",
  "will",
  "with",
  "www",
]);

// Table and column names for tags come from this fixed map, never from user input.
const TAG_LINKS = {
  resources: { table: "resource_tags", column: "resource_id" },
  tasks: { table: "task_tags", column: "task_id" },
};

// One query for the tags of a whole page (instead of JOINing tags into the main query).
async function loadTags(kind, ownerIds) {
  const byOwner = new Map();
  if (!ownerIds.length) return byOwner;
  const { table, column } = TAG_LINKS[kind];
  const [rows] = await pool.query(
    `SELECT l.${column} AS owner_id, t.id, t.name, t.color_hex
       FROM ${table} l
       JOIN tags t ON t.id = l.tag_id
      WHERE l.${column} IN (?)
      ORDER BY t.name`,
    [ownerIds],
  );
  for (const row of rows) {
    if (!byOwner.has(row.owner_id)) byOwner.set(row.owner_id, []);
    byOwner
      .get(row.owner_id)
      .push({ id: row.id, name: row.name, color_hex: row.color_hex });
  }
  return byOwner;
}

function buildResourceFilters({ q, tags }) {
  const where = ["r.is_public = 1"]; // guests only ever see public resources
  const params = [];

  if (q) {
    const tokens = q
      .replace(/[+\-<>()~*"@]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const searchTokens = tokens.filter(
      (t) => !FULLTEXT_STOPWORDS.has(t.toLowerCase()),
    );
    if (
      tokens.length &&
      tokens.every((t) => t.length >= 3) &&
      searchTokens.length
    ) {
      // uses the FULLTEXT index idx_ft_resources (it only indexes words of 3+ letters)
      where.push("MATCH(r.title, r.description) AGAINST (? IN BOOLEAN MODE)");
      params.push(searchTokens.map((t) => `+${t}*`).join(" "));
    } else {
      // short searches: LIKE, with % and _ escaped so "%" means a literal percent sign
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      where.push("(r.title LIKE ? OR r.description LIKE ?)");
      params.push(like, like);
    }
  }
  if (tags.length) {
    // any of the selected tags
    where.push(`EXISTS (SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
                         WHERE rt.resource_id = r.id AND t.name IN (?))`);
    params.push(tags);
  }
  return { where, params };
}

// Uploaded files are private: guests get the download endpoint, never the internal storage path.
const publicFileUrl = (row) =>
  row.file_type === "LINK"
    ? row.file_url
    : `${APP_URL}/api/resources/${row.public_id}/download`;

export async function listPublicResources({
  q = "",
  tags = [],
  page = 1,
  perPage = 20,
} = {}) {
  const { where, params } = buildResourceFilters({ q, tags });
  const [rows] = await pool.query(
    `SELECT r.id, r.public_id, r.title, r.description, r.file_type, r.file_url, r.file_size_bytes,
            r.security_badge, r.download_count, r.created_at,
            u.first_name, u.last_name, u.avatar_url
       FROM resources r
       LEFT JOIN users u ON u.id = r.uploaded_by
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage],
  );
  const tagsByResource = await loadTags(
    "resources",
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({
    public_id: r.public_id,
    title: r.title,
    description: r.description,
    file_type: r.file_type,
    file_url: publicFileUrl(r),
    file_size_bytes:
      r.file_size_bytes === null ? null : Number(r.file_size_bytes),
    is_public: true,
    security_badge: r.security_badge,
    download_count: r.download_count,
    tags: tagsByResource.get(r.id) ?? [],
    uploaded_by: {
      first_name: r.first_name,
      last_name: r.last_name,
      avatar_url: r.avatar_url,
    },
    created_at: r.created_at,
  }));
}

// Doc: tasks are { task_code, title, priority, tags } grouped by status.
export async function listPublicTasks() {
  const [tasks] = await pool.query(
    `SELECT id, task_code, title, status, priority
       FROM tasks
      WHERE is_public = 1
      ORDER BY position ASC
      LIMIT ?`,
    [MAX_TASKS],
  );
  const board = { UNDONE: [], IN_PROGRESS: [], COMPLETED: [] };
  const tagsByTask = await loadTags(
    "tasks",
    tasks.map((t) => t.id),
  );

  for (const t of tasks) {
    board[t.status]?.push({
      task_code: t.task_code,
      title: t.title,
      priority: t.priority,
      tags: tagsByTask.get(t.id) ?? [],
    });
  }
  return board;
}

// ACTIVE users only; never email, id or username.
// Presence is calculated by the database clock, so server time zones cannot make it wrong.
export async function getTeamSummary() {
  const [[summaryRows], [members]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(TIMESTAMPDIFF(SECOND, last_active_at, NOW()) <= ?), 0) AS online
         FROM users WHERE status = 'ACTIVE'`,
      [ONLINE_SECONDS],
    ),
    pool.query(
      `SELECT first_name, last_name, job_title, bio, avatar_url,
              TIMESTAMPDIFF(SECOND, last_active_at, NOW()) AS idle_seconds
         FROM users
        WHERE status = 'ACTIVE'
        ORDER BY first_name, last_name
        LIMIT ?`,
      [MAX_TEAM_MEMBERS],
    ),
  ]);

  const presenceOf = (idle) =>
    idle === null
      ? "offline"
      : idle <= ONLINE_SECONDS
        ? "online"
        : idle <= AWAY_SECONDS
          ? "away"
          : "offline";

  return {
    online: Number(summaryRows[0].online),
    total: Number(summaryRows[0].total),
    members: members.map((m) => ({
      first_name: m.first_name,
      last_name: m.last_name,
      job_title: m.job_title,
      bio: m.bio,
      avatar_url: m.avatar_url,
      presence: presenceOf(m.idle_seconds),
    })),
  };
}

// Only the requested sections are queried, and they run in parallel.
export async function getPublicWorkspace({ sections, q, tags, page, perPage }) {
  const jobs = {
    resources: () => listPublicResources({ q, tags, page, perPage }),
    tasks: listPublicTasks,
    team: getTeamSummary,
  };
  const entries = await Promise.all(
    sections.map(async (name) => [name, await jobs[name]()]),
  );
  return Object.fromEntries(entries);
}
