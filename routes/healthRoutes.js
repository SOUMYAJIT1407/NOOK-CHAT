/**
 * routes/healthRoutes.js — endpoints for the hosting platform's monitoring.
 *   GET /healthz   "is the process alive?"            -> always 200 while the server runs
 *   GET /readyz    "can it serve traffic right now?"  -> 200 when MongoDB is connected, else 503
 * Point your host's health check (Render, Railway, Fly, Kubernetes, Docker...) at /healthz or /readyz.
 */
import express from "express";
import { isDatabaseReady } from "../config/database.js";

const router = express.Router();

router.get("/healthz", (req, res) => {
  res.json({ status: "ok", uptime: Math.round(process.uptime()) });
});

router.get("/readyz", (req, res) => {
  const ready = isDatabaseReady();
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "database unavailable", uptime: Math.round(process.uptime()) });
});

export default router;
