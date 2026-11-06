import pool from '../config/db.js';

/**
 * Shared Helper: Log System & User Activities
 * Inserts structured activity records into the activity_log table.
 * Used by all team modules (Tasks, Discussions, Resources, etc.)
 */
export const logActivity = async ({ actorId = null, type, entityType, entityRef = null, summary }) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO activity_log (actor_id, type, entity_type, entity_ref, summary)
       VALUES (?, ?, ?, ?, ?)`,
      [actorId, type, entityType, entityRef, summary]
    );
    return result.insertId;
  } catch (error) {
    console.error('Failed to record activity log:', error.message);
    return null;
  }
};

/**
 * Shared Helper: Create In-App Notifications
 * Dispatches notifications to recipient users for events like task assignments, mentions, etc.
 */
export const createNotification = async ({
  recipientId,
  actorId = null,
  type,
  title,
  body,
  actionUrl = null
}) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, title, body, action_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [recipientId, actorId, type, title, body, actionUrl]
    );
    return result.insertId;
  } catch (error) {
    console.error('Failed to dispatch notification:', error.message);
    return null;
  }
};