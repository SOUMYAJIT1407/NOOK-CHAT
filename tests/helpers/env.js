/**
 * tests/helpers/env.js — import this FIRST in every test file.
 * Sets safe environment variables before config/env.js is loaded, so the tests never touch a real
 * database, never read your real secrets, and write uploaded test files to a throw-away folder.
 */
import os from "os";
import path from "path";

process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/nook-test"; // never connected to in tests
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.STORAGE_DRIVER = "local";
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `nook-test-uploads-${process.pid}`);
process.env.AUTH_RATE_LIMIT = "1000";
process.env.DELETE_FOR_EVERYONE_MINUTES = "0";
process.env.MAX_UPLOAD_MB = "1";
