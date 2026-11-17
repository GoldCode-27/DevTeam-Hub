import { Router } from "express";
import { authenticate, requirePermission } from "../middlewares/authMiddleware.js";
import * as ctrl from "../controllers/taskController.js";

const router = Router();

// ===========================================================================
// All task management routes strictly require authentication
// ===========================================================================
router.use(authenticate);

// T26: List tasks grouped by status for Kanban Board (with filters & search)
router.get("/", ctrl.listTasks);

// T27: Get task detail by code (e.g. DEV-101) with subtasks, comments & GitHub events
router.get("/:code", ctrl.getTaskDetail);

// T28: Create a task (Requires 'task:create' permission)
router.post(
    "/",
    requirePermission("task:create"),
    ctrl.createTask
);

// T29: Update, move or change a task / Fractional indexing (Requires 'task:update' permission)
router.patch(
    "/:code",
    requirePermission("task:update"),
    ctrl.updateTask
);

// T30: Delete a task (Requires 'task:delete' permission)
router.delete(
    "/:code",
    requirePermission("task:delete"),
    ctrl.deleteTask
);

export default router;