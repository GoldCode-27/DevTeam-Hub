import AppError from "../utils/appError.js";
import * as publicService from "../services/publicService.js";

const SECTIONS = ["resources", "tasks", "team"];
const CACHE_TTL_SECONDS = Number(process.env.PUBLIC_CACHE_TTL_SECONDS) || 30;
const CACHE_MAX_ENTRIES = 200; // stops random query strings from filling memory

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const fail = (details) => {
  throw new AppError("Validation failed", 422, "VALIDATION_ERROR", details);
};

// Query values can be strings, arrays (?a=1&a=2) or objects (?a[b]=1): normalise to a list of strings
const toList = (value) =>
  //ከሊንክ መጨረሻ የሚመጡ ልዩ ልዩ የማጣሪያ መረጃዎችን ወደ አንድ ወጥ የጽሑፍ ሊስት (Array of Strings) የሚቀይር እጅግ ብልህ ተግባር ነው።
  []
    .concat(value ?? [])
    .flatMap((v) => (typeof v === "string" ? v.split(",") : [String(v)]))
    .map((v) => v.trim())
    .filter(Boolean);

    // የእንግዳ ማጣሪያ መርማሪ (parseQuery)
function parseQuery(query = {}) {
  const requested = toList(query.sections).map((s) => s.toLowerCase());
  const unknown = requested.filter((s) => !SECTIONS.includes(s));
  if (unknown.length) {
    fail([
      {
        field: "sections",
        message: `Unknown section(s): ${unknown.join(", ")}. Use ${SECTIONS.join(", ")}`,
      },
    ]);
  }

  const tags = [
    ...new Map(toList(query.tags).map((t) => [t.toLowerCase(), t])).values(),
  ];
  if (tags.length > 10 || tags.some((t) => t.length > 50)) {
    fail([{ field: "tags", message: "Max 10 tags, each up to 50 characters" }]);
  }

  const first = [].concat(query.q ?? [])[0];
  return {
    sections: requested.length ? [...new Set(requested)].sort() : [...SECTIONS],
    q: typeof first === "string" ? first.trim().slice(0, 100) : "",
    tags,
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    perPage: Math.min(Math.max(parseInt(query.per_page, 10) || 20, 1), 100),
  };
}

// ---------------------------------------------------------------------------
// Tiny cache. The key contains EVERY parameter (sections, q, tags, page), so a
// "team only" answer can never be served for a "everything" request.
// It stores the promise, so 100 guests arriving together cause only ONE database load.
// ---------------------------------------------------------------------------
const cache = new Map(); // key -> { promise, expiresAt }

function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;

  const promise = load();
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 });
  // never keep a failed result
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

// ---------------------------------------------------------------------------
// GET /api/public: guest landing page data (no login)
// ---------------------------------------------------------------------------
export const getPublicWorkspace = wrap(async (req, res) => {
  const params = parseQuery(req.query);
  const key = JSON.stringify({
    ...params,
    tags: params.tags.map((t) => t.toLowerCase()).sort(),
  });

  const data = await cached(key, () =>
    publicService.getPublicWorkspace(params),
  );

  res.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`).json(data);
});
