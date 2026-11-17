import db from "../config/db.js";

/**
 * Helper: Generate next unique task code (e.g. DEV-105)
 */
export const generateTaskCode = async () => {
    const rows = await db.safeQuery(
        'SELECT task_code FROM tasks ORDER BY id DESC LIMIT 1'
    );
    if (!rows || rows.length === 0) {
        return 'DEV-101';
    }
    const lastCode = rows[0].task_code;
    const numPart = parseInt(lastCode.split('-')[1], 10);
    return `DEV-${numPart + 1}`;
};

/**
 * T26: List tasks grouped by status for Kanban Board
 */
export const listTasks = async (filters) => {
    let query = `
        SELECT t.*, 
               u_assignee.public_id as assignee_public_id, u_assignee.username as assignee_username, 
               u_assignee.first_name as assignee_first_name, u_assignee.last_name as assignee_last_name, 
               u_assignee.avatar_url as assignee_avatar_url
        FROM tasks t
        LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
        WHERE 1=1
    `;
    const params = [];

    if (filters.q) {
        query += ` AND (t.title LIKE ? OR t.description LIKE ?)`;
        params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.priority) {
        query += ` AND t.priority = ?`;
        params.push(filters.priority);
    }
    if (filters.assignee === 'me' && filters.currentUserId) {
        query += ` AND t.assignee_id = ?`;
        params.push(filters.currentUserId);
    }

    query += ` ORDER BY t.status, t.position ASC`;

    const tasks = await db.safeQuery(query, params);
    const grouped = { UNDONE: [], IN_PROGRESS: [], COMPLETED: [] };

    for (const task of tasks) {
        const tags = await db.safeQuery(`
            SELECT tg.id, tg.name, tg.color_hex 
            FROM task_tags tt 
            JOIN tags tg ON tt.tag_id = tg.id 
            WHERE tt.task_id = ?
        `, [task.id]);
        
        const formattedTask = {
            task_code: task.task_code,
            title: task.title,
            status: task.status,
            priority: task.priority,
            position: task.position,
            due_date: task.due_date,
            is_public: Boolean(task.is_public),
            assignee: task.assignee_id ? {
                public_id: task.assignee_public_id,
                username: task.assignee_username,
                first_name: task.assignee_first_name,
                last_name: task.assignee_last_name,
                avatar_url: task.assignee_avatar_url
            } : null,
            tags: tags || []
        };

        if (grouped[task.status]) {
            grouped[task.status].push(formattedTask);
        }
    }

    return grouped;
};

/**
 * T27: Get task detail by code (DEV-101)
 */
export const getTaskDetail = async (taskCode) => {
    const [tasks] = await db.safeQuery(`
        SELECT t.*, 
               u_assignee.public_id as a_pub, u_assignee.username as a_usr, u_assignee.first_name as a_fn, u_assignee.last_name as a_ln, u_assignee.avatar_url as a_av,
               u_creator.public_id as c_pub, u_creator.username as c_usr, u_creator.first_name as c_fn, u_creator.last_name as c_ln, u_creator.avatar_url as c_av
        FROM tasks t
        LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
        JOIN users u_creator ON t.created_by = u_creator.id
        WHERE t.task_code = ?
    `, [taskCode]);

    if (!tasks || tasks.length === 0) return null;
    const task = tasks;

    const subtasks = await db.safeQuery(
        'SELECT id, title, is_done FROM subtasks WHERE task_id = ? ORDER BY position ASC',
        [task.id]
    );
    const doneCount = subtasks.filter(s => s.is_done).length;

    const comments = await db.safeQuery(`
        SELECT tc.id, tc.content, tc.created_at,
               u.public_id, u.username, u.first_name, u.last_name, u.avatar_url
        FROM task_comments tc
        JOIN users u ON tc.author_id = u.id
        WHERE tc.task_id = ?
        ORDER BY tc.created_at ASC
    `, [task.id]);

    const githubEvents = await db.safeQuery(
        'SELECT event_type, external_ref, repository_name, action, title, author_username, url FROM task_github_events WHERE task_id = ?',
        [task.id]
    );

    return {
        task_code: task.task_code,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        position: task.position,
        due_date: task.due_date,
        is_public: Boolean(task.is_public),
        completed_at: task.completed_at,
        assignee: task.assignee_id ? {
            public_id: task.a_pub, username: task.a_usr, first_name: task.a_fn, last_name: task.a_ln, avatar_url: task.a_av
        } : null,
        created_by: {
            public_id: task.c_pub, username: task.c_usr, first_name: task.c_fn, last_name: task.c_ln, avatar_url: task.c_av
        },
        subtasks: {
            done: doneCount,
            total: subtasks.length,
            items: subtasks
        },
        comments: comments.map(c => ({
            id: c.id,
            type: 'task',
            author: { public_id: c.public_id, username: c.username, first_name: c.first_name, last_name: c.last_name, avatar_url: c.avatar_url },
            content: c.content,
            created_at: c.created_at
        })),
        github_events: githubEvents
    };
};

/**
 * T28: Create a task
 */
export const createTask = async (userId, data) => {
    const taskCode = await generateTaskCode();
    const position = 65535.0000;

    const result = await db.safeQuery(`
        INSERT INTO tasks (task_code, title, description, status, priority, is_public, position, due_date, assignee_id, created_by)
        VALUES (?, ?, ?, 'UNDONE', ?, ?, ?, ?, ?, ?)
    `, [
        taskCode,
        data.title,
        data.description || null,
        data.priority || 'MEDIUM',
        data.is_public ? 1 : 0,
        position,
        data.due_date || null,
        data.assignee_id || null,
        userId
    ]);

    const taskId = result.insertId;

    if (data.subtasks && Array.isArray(data.subtasks)) {
        for (const subTitle of data.subtasks) {
            await db.safeQuery(
                'INSERT INTO subtasks (task_id, title, is_done) VALUES (?, ?, false)',
                [taskId, subTitle]
            );
        }
    }

    return await getTaskDetail(taskCode);
};

/**
 * T29: Update, move or change a task (Fractional Indexing)
 */
export const updateTask = async (taskCode, data) => {
    const [tasks] = await db.safeQuery('SELECT id, status, position FROM tasks WHERE task_code = ?', [taskCode]);
    if (!tasks || tasks.length === 0) return null;
    const task = tasks;

    let newPosition = task.position;

    if (data.before_task_code || data.after_task_code) {
        let beforePos = null;
        let afterPos = null;

        if (data.before_task_code) {
            const [bRows] = await db.safeQuery('SELECT position FROM tasks WHERE task_code = ?', [data.before_task_code]);
            if (bRows && bRows.length) beforePos = parseFloat(bRows.position);
        }
        if (data.after_task_code) {
            const [aRows] = await db.safeQuery('SELECT position FROM tasks WHERE task_code = ?', [data.after_task_code]);
            if (aRows && aRows.length) afterPos = parseFloat(aRows.position);
        }

        if (beforePos !== null && afterPos !== null) {
            newPosition = (beforePos + afterPos) / 2;
        } else if (beforePos !== null) {
            newPosition = beforePos + 1000;
        } else if (afterPos !== null) {
            newPosition = afterPos / 2;
        }
    }

    let completedAtQuery = '';
    if (data.status === 'COMPLETED' && task.status !== 'COMPLETED') {
        completedAtQuery = ', completed_at = NOW()';
    } else if (data.status && data.status !== 'COMPLETED') {
        completedAtQuery = ', completed_at = NULL';
    }

   await db.safeQuery(`
        UPDATE tasks 
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            status = COALESCE(?, status),
            priority = COALESCE(?, priority),
            is_public = COALESCE(?, is_public),
            due_date = COALESCE(?, due_date),
            assignee_id = COALESCE(?, assignee_id),
            position = ?
            ${completedAtQuery}
        WHERE task_code = ?
    `, [
        data.title !== undefined ? data.title : null,
        data.description !== undefined ? data.description : null,
        data.status !== undefined ? data.status : null,
        data.priority !== undefined ? data.priority : null,
        data.is_public !== undefined ? (data.is_public ? 1 : 0) : null,
        data.due_date !== undefined ? data.due_date : null,
        data.assignee_id !== undefined ? data.assignee_id : null,
        newPosition,
        taskCode
    ]);

    if (data.subtasks) {
        if (data.subtasks.add && Array.isArray(data.subtasks.add)) {
            for (const subTitle of data.subtasks.add) {
                await db.safeQuery('INSERT INTO subtasks (task_id, title, is_done) VALUES (?, ?, false)', [task.id, subTitle]);
            }
        }
        if (data.subtasks.update && Array.isArray(data.subtasks.update)) {
            for (const sub of data.subtasks.update) {
                await db.safeQuery('UPDATE subtasks SET is_done = ? WHERE id = ? AND task_id = ?', [sub.is_done ? 1 : 0, sub.id, task.id]);
            }
        }
        if (data.subtasks.remove && Array.isArray(data.subtasks.remove)) {
            for (const subId of data.subtasks.remove) {
                await db.safeQuery('DELETE FROM subtasks WHERE id = ? AND task_id = ?', [subId, task.id]);
            }
        }
    }

    return await getTaskDetail(taskCode);
};

/**
 * T30: Delete a task
 */
export const deleteTask = async (taskCode) => {
    const [tasks] = await db.safeQuery('SELECT id FROM tasks WHERE task_code = ?', [taskCode]);
    if (!tasks || tasks.length === 0) return false;

    await db.safeQuery('DELETE FROM tasks WHERE task_code = ?', [taskCode]);
    return true;
};