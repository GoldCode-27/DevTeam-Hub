import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
const SECRET =
  process.env.STORAGE_SIGNING_SECRET || "devteam-hub-secret-key-999";
const TTL = parseInt(process.env.SIGNED_URL_TTL_SECONDS || "120", 10);
const APP_URL = process.env.APP_URL || "http://localhost:8080";

// Ensure base upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const getFileType = (extWithDot) => {
  const ext = (extWithDot || "").replace(".", "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext))
    return "IMAGE";
  if (["pdf"].includes(ext)) return "PDF";
  if (["doc", "docx", "txt", "rtf"].includes(ext)) return "DOC";
  if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) return "ARCHIVE";
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "html",
      "css",
      "json",
      "sql",
      "md",
    ].includes(ext)
  )
    return "CODE";
  return "OTHER";
};

export const createSignedToken = (relativePath, originalName) => {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL;
  const payload = Buffer.from(
    JSON.stringify({ path: relativePath, name: originalName, exp: expiresAt }),
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};

export const verifySignedToken = (token) => {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");

  const expectedSignature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");
  if (signature !== expectedSignature) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Math.floor(Date.now() / 1000) > data.exp) return null; // Expired
    return data;
  } catch {
    return null;
  }
};

export const generateSignedDownloadUrl = (relativePath, originalName) => {
  const token = createSignedToken(relativePath, originalName);
  return `${APP_URL}/api/files/${token}`;
};

export const deleteLocalFile = (relativePath) => {
  if (!relativePath) return;
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlink(absolutePath, () => {});
  }
};
