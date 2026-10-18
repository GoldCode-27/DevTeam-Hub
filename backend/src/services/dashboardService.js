import pool from '../config/db.js';

/**
 * Dashboard Aggregation Service
 * Executes high-performance database queries concurrently using Promise.all
 */
export const getDashboardSummary = async (currentUser) => {
  // 1. Concurrent queries execution for maximum performance
  const [
    [myTaskItems],
    [myTaskCount],
    [pulse],
    [stats],
    [recentActivities],
    [adminData]
  ] = await Promise.all([
    // A. My Active Tasks (assigned to current user, not completed)
    pool.query(
      `SELECT task_code, title, priority, due_date 
       FROM tasks 
       WHERE assignee_id = ? AND status != 'COMPLETED'
       ORDER BY position ASC 
       LIMIT 10`,
      [currentUser.id]
    ),

    // B. Count of My Active Tasks
    pool.query(
      `SELECT COUNT(*) AS active_count 
       FROM tasks 
       WHERE assignee_id = ? AND status != 'COMPLETED'`,
      [currentUser.id]
    ),

    // C. Team Pulse (Total active users & online users active in last 2 minutes)
    pool.query(
      `SELECT 
         COUNT(*) AS total,
         COUNT(CASE WHEN last_active_at >= NOW() - INTERVAL 2 MINUTE THEN 1 END) AS online
       FROM users 
       WHERE status = 'ACTIVE'`
    ),

    // D. Quick Stats (Single-pass conditional aggregation across all tasks)
    pool.query(
      `SELECT 
         COUNT(CASE WHEN assignee_id IS NOT NULL THEN 1 END) AS assigned,
         COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) AS in_progress,
         COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed,
         COUNT(CASE WHEN status = 'UNDONE' THEN 1 END) AS pending
       FROM tasks`
    ),

    // E. Recent Activity Stream (Latest 5 logs with actor details)
    pool.query(
      `SELECT 
         a.id, a.type, a.entity_type, a.entity_ref, a.summary, a.created_at,
         u.public_id AS actor_public_id, u.username AS actor_username, 
         u.first_name AS actor_first_name, u.last_name AS actor_last_name, 
         u.avatar_url AS actor_avatar_url
       FROM activity_log a
       LEFT JOIN users u ON a.actor_id = u.id
       ORDER BY a.created_at DESC 
       LIMIT 5`
    ),

    // F. Admin Inactive Members (Members inactive for 72+ hours)
    pool.query(
      `SELECT public_id, username, first_name, last_name, avatar_url, last_active_at
       FROM users
       WHERE status = 'ACTIVE' AND (last_active_at < NOW() - INTERVAL 72 HOUR OR last_active_at IS NULL)`
    )
  ]);

  // 2. Format Recent Activities output
  const formattedActivities = recentActivities.map(act => ({
    id: act.id,
    type: act.type,
    actor: act.actor_public_id ? {
      public_id: act.actor_public_id,
      username: act.actor_username,
      first_name: act.actor_first_name,
      last_name: act.actor_last_name,
      avatar_url: act.actor_avatar_url
    } : null,
    entity_type: act.entity_type,
    entity_ref: act.entity_ref,
    summary: act.summary,
    created_at: act.created_at
  }));

  // 3. Assemble base dashboard payload
  const dashboardPayload = {
    my_tasks: {
      active: myTaskCount[0].active_count,
      items: myTaskItems
    },
    team_pulse: {
      online: Number(pulse[0].online),
      total: Number(pulse[0].total)
    },
    quick_stats: {
      assigned: Number(stats[0].assigned),
      in_progress: Number(stats[0].in_progress),
      completed: Number(stats[0].completed),
      pending: Number(stats[0].pending)
    },
    recent_activity: formattedActivities
  };

  // 4. RBAC Guard: Include admin_summary strictly if user holds 'user:manage' permission
  const isAdmin = currentUser.permissions && currentUser.permissions.includes('user:manage');

  if (isAdmin) {
    const totalMembers = Number(pulse[0].total);
    const inactiveCount = adminData.length;
    const inactiveRate = totalMembers > 0 ? Number((inactiveCount / totalMembers).toFixed(3)) : 0;

    dashboardPayload.admin_summary = {
      tasks: {
        total: Number(stats[0].assigned) + Number(stats[0].pending),
        in_progress: Number(stats[0].in_progress),
        completed: Number(stats[0].completed)
      },
      members: {
        total: totalMembers,
        inactive: inactiveCount,
        inactive_rate: inactiveRate
      },
      inactive_members: adminData
    };
  }

  return dashboardPayload;
};