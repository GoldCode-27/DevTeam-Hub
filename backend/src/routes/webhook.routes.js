import { Router } from "express";
import * as ctrl from "../controllers/githubController.js";

const router = Router();

// ===========================================================================
// T31: GitHub Webhook Integration Endpoint (Publicly accessible for GitHub POSTs)
// ===========================================================================
router.post("/github", ctrl.handleWebhook);

export default router;