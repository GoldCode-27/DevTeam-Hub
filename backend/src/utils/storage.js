import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ---------- ቅንብሮች (settings) ----------
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? "uploads");
const TTL_SECONDS = Number(process.env.SIGNED_URL_TTL_SECONDS) || 120;
const APP_URL = (process.env.APP_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);

// ሚስጥራዊ ቁልፍ በኮድ ውስጥ ነባሪ ዋጋ የለውም፤ ከጠፋ ፕሮግራሙ ወዲያው ስህተት ይሰጣል
const SECRET = process.env.STORAGE_SIGNING_SECRET;
if (!SECRET) {
  throw new Error(
    "STORAGE_SIGNING_SECRET is missing in .env (use a random string of 32+ characters)",
  );
}

// mkdirSync ፎልደሩ ካለ ስህተት አይሰጥም፤ ስለዚህ existsSync አያስፈልግም
mkdirSync(UPLOAD_ROOT, { recursive: true });

// ---------- የፋይል ዓይነት ----------
// ዝርዝሩ አንድ ጊዜ ብቻ ይገነባል (በየጥሪው አዲስ array አይፈጠርም)
const TYPE_BY_EXTENSION = new Map(
  Object.entries({
    IMAGE: ["jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "ico"],
    PDF: ["pdf"],
    DOC: [
      "doc",
      "docx",
      "txt",
      "rtf",
      "odt",
      "xls",
      "xlsx",
      "csv",
      "ppt",
      "pptx",
    ],
    ARCHIVE: ["zip", "rar", "tar", "gz", "tgz", "7z"],
    CODE: [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "cs",
      "go",
      "rs",
      "php",
      "html",
      "css",
      "json",
      "sql",
      "md",
      "sh",
      "yml",
      "yaml",
      "xml",
    ],
  }).flatMap(([type, extensions]) => extensions.map((ext) => [ext, type])),
);

export const getFileType = (extWithDot) => {
  const ext = String(extWithDot ?? "")
    .replace(/^\./, "")
    .toLowerCase();
  return TYPE_BY_EXTENSION.get(ext) ?? "OTHER";
};

// ---------- አስተማማኝ የፋይል አድራሻ ----------
// አድራሻው ከ UPLOAD_ROOT ውጭ ከሆነ (ለምሳሌ "../../.env") null ይመልሳል
export const resolveUploadPath = (relativePath) => {
  if (typeof relativePath !== "string" || relativePath === "") return null;
  const fullPath = path.resolve(relativePath); // አሁን ካለህበት ፎልደር አንጻር (እንደ ድሮው)
  return fullPath.startsWith(UPLOAD_ROOT + path.sep) ? fullPath : null;
};

// ---------- የተፈረመ ምልክት ----------
const sign = (payload) =>
  crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");

// ለ Content-Disposition አደገኛ የሆኑ ምልክቶችን ያስወግዳል
const safeName = (name) =>
  path.basename(String(name ?? "file")).replace(/[\r\n"\\]/g, "_");

export const createSignedToken = (relativePath, originalName) => {
  const payload = Buffer.from(
    JSON.stringify({
      path: relativePath,
      name: safeName(originalName),
      exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
};

export const verifySignedToken = (token) => {
  if (typeof token !== "string") return null;
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length > 0) return null;

  // ፊርማዎችን በ"ቋሚ ጊዜ" ማነጻጸር (timing attack ይከላከላል)
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || Date.now() / 1000 > data.exp)
      return null; // ጊዜው አልፏል
    if (!resolveUploadPath(data.path)) return null; // ከ uploads ውጭ ነው
    return data;
  } catch {
    return null;
  }
};

export const generateSignedDownloadUrl = (relativePath, originalName) =>
  `${APP_URL}/api/files/${createSignedToken(relativePath, originalName)}`;

// ---------- ፋይል መሰረዝ ----------
export const deleteLocalFile = async (relativePath) => {
  if (!relativePath) return;
  const fullPath = resolveUploadPath(relativePath);
  if (!fullPath) {
    console.warn(
      "[storage] refused to delete a path outside the upload folder:",
      relativePath,
    );
    return;
  }
  try {
    await unlink(fullPath);
  } catch (err) {
    // ፋይሉ አስቀድሞ ከሌለ ችግር የለም፤ ሌላ ስህተት ግን እንዳይደበቅ ይመዘገባል
    if (err.code !== "ENOENT")
      console.error("[storage] delete failed:", err.message);
  }
};
