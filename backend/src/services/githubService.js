import db from '../config/db.js';

/**
 * T31: Handle GitHub Webhook (Parse PR title for task code, e.g. DEV-101, and link to task_github_events)
 */
export const handleGitHubWebhook = async (payload) => {
    const pr = payload.pull_request;
    if (!pr) {
        return { success: true, message: 'Ignored non-PR event' };
    }

    const prTitle = pr.title; // e.g. "DEV-101 add auth middleware"
    const match = prTitle.match(/(DEV-\d+)/i);
    if (!match) {
        return { success: true, message: 'No task code found in PR title' };
    }

    const taskCode = match[1].toUpperCase();
    
    // Find task ID by task_code
    const tasks = await db.safeQuery('SELECT id FROM tasks WHERE task_code = ?', [taskCode]);
    if (!tasks || tasks.length === 0) {
        return { success: false, message: 'Task not found' };
    }

    const taskId = tasks[0].id;
    const externalRef = `PR#${payload.number || pr.number}`;
    const repoName = payload.repository.name;
    const action = payload.action; // 'opened', 'closed', 'merged', etc.
    const authorUsername = pr.user.login;
    const prUrl = pr.html_url;

    // 1. Insert or update into task_github_events table
    await db.safeQuery(`
        INSERT INTO task_github_events (task_id, event_type, external_ref, repository_name, action, title, author_username, url)
        VALUES (?, 'PULL_REQUEST', ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE action = VALUES(action)
    `, [taskId, externalRef, repoName, action, prTitle, authorUsername, prUrl]);


    let newStatus = null;

    if (action === 'opened') {
        newStatus = 'IN_PROGRESS'; 
    } else if (action === 'closed' && pr.merged) {
        newStatus = 'DONE'; 
    }

 
    if (newStatus) {
        await db.safeQuery(`
            UPDATE tasks 
            SET status = ? 
            WHERE id = ?
        `, [newStatus, taskId]);
    }


    return { 
        success: true, 
        task_code: taskCode, 
        pr: externalRef,
        action: action,
        updated_status: newStatus || "UNCHANGED"
    };
};