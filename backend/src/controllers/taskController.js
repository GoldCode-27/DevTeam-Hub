import * as taskService from '../services/taskService.js';

/**
 * T26: List tasks grouped by status for Kanban Board
 */
export const listTasks = async (req, res, next) => {
    try {
        const filters = {
            q: req.query.q,
            priority: req.query.priority,
            assignee: req.query.assignee,
            currentUserId: req.user ? req.user.id : null
        };
        const result = await taskService.listTasks(filters);
        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};

/**
 * T27: Get task detail by code (DEV-101)
 */
export const getTaskDetail = async (req, res, next) => {
    try {
        const task = await taskService.getTaskDetail(req.params.code);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }
        return res.status(200).json(task);
    } catch (error) {
        next(error);
    }
};

/**
 * T28: Create a task
 */
export const createTask = async (req, res, next) => {
    try {
        const userId = req.user ? req.user.id : null;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized user' });
        }
        const newTask = await taskService.createTask(userId, req.body);
        return res.status(201).json(newTask);
    } catch (error) {
        next(error);
    }
};

/**
 * T29: Update, move or change a task (Fractional Indexing & Subtasks)
 */
export const updateTask = async (req, res, next) => {
    try {
        const updated = await taskService.updateTask(req.params.code, req.body);
        if (!updated) {
            return res.status(404).json({ error: 'Task not found' });
        }
        return res.status(200).json(updated);
    } catch (error) {
        next(error);
    }
};

/**
 * T30: Delete a task
 */
export const deleteTask = async (req, res, next) => {
    try {
        const deleted = await taskService.deleteTask(req.params.code);
        if (!deleted) {
            return res.status(404).json({ error: 'Task not found' });
        }
        return res.status(204).send();
    } catch (error) {
        next(error);
    }
};