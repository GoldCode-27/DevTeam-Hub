import safeQuery from '../config/db.js';

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
    const tasks = await safeQuery('SELECT id FROM tasks WHERE task_code = ?', [taskCode]);
    if (!tasks || tasks.length === 0) {
        return { success: false, message: 'Task not found' };
    }

    const taskId = tasks[0].id;
    const externalRef = `PR#${payload.number || pr.number}`;
    const repoName = payload.repository.name;
    const action = payload.action; // 'opened', 'closed', 'merged', etc.
    const authorUsername = pr.user.login;
    const prUrl = pr.html_url;

    // Insert or update into task_github_events table
    await safeQuery(`
        INSERT INTO task_github_events (task_id, event_type, external_ref, repository_name, action, title, author_username, url)
        VALUES (?, 'PULL_REQUEST', ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE action = VALUES(action)
    `, [taskId, externalRef, repoName, action, prTitle, authorUsername, prUrl]);

    return { 
        success: true, 
        task_code: taskCode, 
        pr: externalRef,
        action: action 
    };
};