import pool from '../config/db.js';
import safeQuery from '../config/db.js';
/**
 * Activity Aggregation & Stream Service
 * Aggregates task counters, weekly daily trends, and user/team activity logs.
 */
export const getActivitiesData = async (currentUser, query) => {
  const scope = query.scope === 'all' ? 'all' : 'me';
  const rangeDays = query.range === '30d' ? 30 : 7;
  const filterType = query.type || null;

  // 1. Fetch task overview counters using single-pass conditional aggregation
  const [taskRows] = await safeQuery(
    `SELECT 
       COUNT(CASE WHEN assignee_id IS NOT NULL THEN 1 END) AS assigned,
       COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) AS in_progress,
       COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed,
       COUNT(CASE WHEN status = 'UNDONE' THEN 1 END) AS pending
     FROM tasks`
  );
  const taskStats = taskRows && taskRows[0] ? taskRows[0] : {};

  // 2. Build dynamic daily trend query for charting
  let weeklySql = `
    SELECT 
      DATE_FORMAT(created_at, '%Y-%m-%d') AS date,
      COUNT(*) AS count
    FROM activity_log
    WHERE created_at >= NOW() - INTERVAL ? DAY
  `;
  const weeklyParams = [rangeDays];

  if (scope === 'me') {
    weeklySql += ' AND actor_id = ?';
    weeklyParams.push(currentUser.id);
  }

  // Solved: Using double quotes to prevent quote collisions with '%Y-%m-%d'
  weeklySql += " GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY date ASC";

  const [weeklyTrends] = await pool.query(weeklySql, weeklyParams);

  // 3. Build dynamic feed query for the detailed activity log
  let feedSql = `
    SELECT 
      a.id,
      a.type,
      a.entity_type,
      a.entity_ref,
      a.summary,
      a.created_at,
      u.public_id AS actor_public_id,
      u.username AS actor_username,
      u.first_name AS actor_first_name,
      u.last_name AS actor_last_name,
      u.avatar_url AS actor_avatar_url
    FROM activity_log a
    LEFT JOIN users u ON a.actor_id = u.id
    WHERE a.created_at >= NOW() - INTERVAL ? DAY
  `;
  const feedParams = [rangeDays];

  if (scope === 'me') {
    feedSql += ' AND a.actor_id = ?';
    feedParams.push(currentUser.id);
  }

  if (filterType) {
    feedSql += ' AND a.type = ?';
    feedParams.push(filterType);
  }

  feedSql += ' ORDER BY a.created_at DESC LIMIT 50';

  const [activityRows] = await pool.query(feedSql, feedParams);

  // 4. Structure actor object to match the API specification contract
  const formattedActivities = activityRows.map((act) => ({
    id: act.id,
    type: act.type,
    actor: act.actor_public_id
      ? {
        public_id: act.actor_public_id,
        username: act.actor_username,
        first_name: act.actor_first_name,
        last_name: act.actor_last_name,
        avatar_url: act.actor_avatar_url
      }
      : null,
    entity_type: act.entity_type,
    entity_ref: act.entity_ref,
    summary: act.summary,
    created_at: act.created_at
  }));

  // 5. Return combined payload
  return {
    counters: {
      assigned: Number(taskStats.assigned || 0),
      in_progress: Number(taskStats.in_progress || 0),
      completed: Number(taskStats.completed || 0),
      pending: Number(taskStats.pending || 0)
    },
    weekly: weeklyTrends.map((trend) => ({
      date: trend.date,
      count: Number(trend.count)
    })),
    activities: formattedActivities
  };
};