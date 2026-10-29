/**
 * services/storage.js — where uploaded files and profile pictures are kept.
 * ------------------------------------------------------------------------------------------
 * One small API, two interchangeable back-ends chosen by STORAGE_DRIVER:
 *
 *   gridfs (default)  files live INSIDE MongoDB (GridFS). The app server itself stays stateless,
 *                     so redeploys, restarts, autoscaling and "ephemeral disk" hosts never lose
 *                     a shared image. No extra service or credentials needed.
 *   local             files live in UPLOAD_DIR (uploads/files, uploads/avatars). Handy for local
 *                     development; on the cloud it needs a persistent disk.
 *
 * Files are addressed by a random "key" (e.g. 3f9c…e1.png). `kind` is "chat" or "avatar".
 * With gridfs, files from older versions of this project that still sit in the local uploads/
 * folder are found as a fallback, so upgrading never breaks existing images.
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { config } from "../config/env.js";

const BUCKET_NAME = "nook_files";
const SUBDIR = { chat: "files", avatar: "avatars" };

let bucket = null;
const getBucket = () => (bucket ||= new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME }));

const localPath = (kind, key) => path.join(config.uploadDir, SUBDIR[kind] || SUBDIR.chat, path.basename(key));

/** Create folders / log the active driver. Call once after the database is connected. */
export async function initStorage() {
  if (config.storageDriver === "local") {
    for (const dir of Object.values(SUBDIR)) await fs.promises.mkdir(path.join(config.uploadDir, dir), { recursive: true });
  }
  console.log(`[storage] driver: ${config.storageDriver}${config.storageDriver === "local" ? ` (${config.uploadDir})` : " (MongoDB GridFS)"}`);
}

/** Save a Buffer under `key`. */
export async function saveFile(kind, key, buffer, { mime = "application/octet-stream", name = key } = {}) {
  if (config.storageDriver === "local") {
    await fs.promises.writeFile(localPath(kind, key), buffer);
    return;
  }
  await new Promise((resolve, reject) => {
    const upload = getBucket().openUploadStream(key, { metadata: { kind, mime, name } });
    upload.once("finish", resolve);
    upload.once("error", reject);
    upload.end(buffer);
  });
}

/**
 * Describes a stored file: { size, mime, source, ... } or null when it does not exist.
 * Pass the result to readFile().
 */
export async function statFile(kind, key) {
  if (config.storageDriver === "gridfs") {
    const doc = (await getBucket().find({ filename: key }).limit(1).toArray())[0];
    if (doc) return { source: "gridfs", key, id: doc._id, size: doc.length, mime: doc.metadata?.mime || null };
  }
  try { // local driver, or an older file that was saved on disk before GridFS was used
    const file = localPath(kind, key);
    const stat = await fs.promises.stat(file);
    if (stat.isFile()) return { source: "local", key, path: file, size: stat.size, mime: null };
  } catch { /* not there */ }
  return null;
}

/** A readable stream of the file, optionally only bytes [start, end] (inclusive) for HTTP Range requests. */
export function readFile(descriptor, { start, end } = {}) {
  const ranged = Number.isInteger(start) && Number.isInteger(end);
  if (descriptor.source === "local") return fs.createReadStream(descriptor.path, ranged ? { start, end } : undefined);
  return getBucket().openDownloadStream(descriptor.id, ranged ? { start, end: end + 1 } : undefined); // GridFS "end" is exclusive
}

/** Delete a file. Never throws — a missing file is not an error. */
export async function removeFile(kind, key) {
  try {
    if (config.storageDriver === "gridfs") {
      const docs = await getBucket().find({ filename: key }).toArray();
      for (const doc of docs) await getBucket().delete(doc._id).catch(() => {});
    }
    await fs.promises.unlink(localPath(kind, key)).catch(() => {});
  } catch (error) {
    console.warn(`[storage] could not remove ${key}:`, error.message);
  }
}
