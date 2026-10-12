
-- =====================================================================
-- DATABASE SETUP
-- =====================================================================

DROP DATABASE IF EXISTS devteam_hub;
CREATE DATABASE devteam_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE devteam_hub;

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';


-- =====================================================================
-- SHARED UTILITIES
-- =====================================================================

DELIMITER $$

-- Time-ordered UUID v7 (index-friendly, distributed-safe)
CREATE FUNCTION uuid_v7() RETURNS BINARY(16)
DETERMINISTIC
BEGIN
  DECLARE ts BINARY(6);
  DECLARE rand_bytes BINARY(10);
  SET ts = UNHEX(LPAD(CONV(FLOOR(UNIX_TIMESTAMP() * 1000), 10, 16), 12, '0'));
  SET rand_bytes = RANDOM_BYTES(10);
  RETURN CONCAT(ts, UNHEX('7'), SUBSTRING(rand_bytes, 1, 1),
                UNHEX('8'), SUBSTRING(rand_bytes, 2, 9));
END$$

-- Generate VDD-VD style external ID (e.g., PRJ-2024-00001)
CREATE FUNCTION generate_vdd(
  IN p_prefix VARCHAR(8),
  IN p_seq    BIGINT UNSIGNED
) RETURNS VARCHAR(32)
DETERMINISTIC
BEGIN
  RETURN CONCAT(
    UPPER(p_prefix), '-',
    YEAR(UTC_TIMESTAMP()), '-',
    LPAD(p_seq, 5, '0')
  );
END$$

-- Generic audit logging procedure
CREATE PROCEDURE log_audit(
  IN p_table     VARCHAR(64),
  IN p_record_id BIGINT,
  IN p_action    VARCHAR(20),
  IN p_user_id   BIGINT,
  IN p_changes   JSON
)
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, user_id, changes_json, created_at)
  VALUES (p_table, p_record_id, p_action, p_user_id, p_changes, UTC_TIMESTAMP());
END$$

DELIMITER ;


-- =====================================================================
-- 1. USERS
-- =====================================================================

CREATE TABLE users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),

  -- VDD-VD style public ID (e.g., USR-2024-00001)
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,

  username          VARCHAR(50)  NOT NULL,
  email             VARCHAR(191) NOT NULL,
  email_verified_at DATETIME DEFAULT NULL,
  full_name         VARCHAR(120) NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  avatar_url        VARCHAR(500) DEFAULT NULL,
  bio               VARCHAR(280) DEFAULT NULL,
  locale            VARCHAR(10) NOT NULL DEFAULT 'en',
  timezone          VARCHAR(50) NOT NULL DEFAULT 'UTC',

  preferences       JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'theme', 'light',
                      'notifications', JSON_OBJECT('email', TRUE, 'push', TRUE)
                    )),

  status            ENUM('active','suspended','pending','deleted')
                    NOT NULL DEFAULT 'active',
  last_login_at     DATETIME DEFAULT NULL,
  last_login_ip     VARBINARY(16) DEFAULT NULL,

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,

  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  INDEX idx_users_vdd (vdd_id),
  INDEX idx_users_status (status, deleted_at),
  FULLTEXT KEY ft_users_search (username, full_name, bio)
) ENGINE=InnoDB
  COMMENT='Core user accounts with VDD-VD public identifier';


-- =====================================================================
-- 2. PERMISSIONS
-- =====================================================================

-- Permission catalog (actions a user can perform)
CREATE TABLE permissions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(80) NOT NULL UNIQUE,   -- task.create, resource.read
  display_name      VARCHAR(120) NOT NULL,
  category          VARCHAR(40) NOT NULL,           -- task, resource, user, chat
  description       VARCHAR(255) DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  INDEX idx_perm_category (category)
) ENGINE=InnoDB;


-- Grant permissions to users (with optional resource scoping)
CREATE TABLE user_permissions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  permission_id     BIGINT UNSIGNED NOT NULL,

  scope_type        ENUM('global','task','resource','chat','discussion')
                    NOT NULL DEFAULT 'global',
  scope_id          BIGINT UNSIGNED DEFAULT NULL,

  granted_by        BIGINT UNSIGNED DEFAULT NULL,
  granted_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  expires_at        DATETIME DEFAULT NULL,

  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_up_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_up_grant FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE KEY uq_user_perm_scope (user_id, permission_id, scope_type, scope_id),
  INDEX idx_up_scope (scope_type, scope_id),
  INDEX idx_up_expires (expires_at)
) ENGINE=InnoDB;

INSERT INTO permissions (name, display_name, category) VALUES
('task.create',    'Create Task',        'task'),
('task.read',      'View Task',          'task'),
('task.update',    'Update Task',        'task'),
('task.delete',    'Delete Task',        'task'),
('resource.create','Upload Resource',    'resource'),
('resource.read',  'View Resource',      'resource'),
('resource.delete','Delete Resource',    'resource'),
('message.send',   'Send Message',       'message'),
('comment.create', 'Post Comment',       'comment'),
('comment.moderate','Moderate Comments', 'comment'),
('chat.create',    'Create Chat',        'chat'),
('chat.join',      'Join Chat',          'chat'),
('user.manage',    'Manage Users',       'user'),
('admin.all',      'Full Admin Access',  'admin');


-- =====================================================================
-- 3. TASKS
-- =====================================================================

CREATE TABLE tasks (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- TSK-2024-00001

  title             VARCHAR(255) NOT NULL,
  description       TEXT DEFAULT NULL,

  status            ENUM('backlog','todo','in_progress','review','done','cancelled')
                    NOT NULL DEFAULT 'backlog',
  priority          ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',

  reporter_id       BIGINT UNSIGNED NOT NULL,      -- who created
  assignee_id       BIGINT UNSIGNED DEFAULT NULL,  -- who works on it

  due_at            DATETIME DEFAULT NULL,
  started_at        DATETIME DEFAULT NULL,
  completed_at      DATETIME DEFAULT NULL,

  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,

  CONSTRAINT fk_tasks_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_tasks_status (status, priority),
  INDEX idx_tasks_assignee (assignee_id, status),
  INDEX idx_tasks_due (due_at),
  INDEX idx_tasks_vdd (vdd_id),
  FULLTEXT KEY ft_tasks_search (title, description)
) ENGINE=InnoDB;


-- Task ↔ Tag (many-to-many)
CREATE TABLE task_tags (
  task_id           BIGINT UNSIGNED NOT NULL,
  tag_id            BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  PRIMARY KEY (task_id, tag_id),
  CONSTRAINT fk_tt_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- =====================================================================
-- 4. RESOURCES
-- =====================================================================

CREATE TABLE resources (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- RSC-2024-00001
  rd_id             VARCHAR(32) NOT NULL UNIQUE,   -- RD-00001 (Resource ID)

  name              VARCHAR(255) NOT NULL,
  description       TEXT DEFAULT NULL,

  resource_type     ENUM('file','image','video','document','link','code','other')
                    NOT NULL DEFAULT 'file',
  mime_type         VARCHAR(120) DEFAULT NULL,
  size_bytes        BIGINT UNSIGNED DEFAULT NULL,
  storage_path      VARCHAR(500) DEFAULT NULL,
  external_url      VARCHAR(500) DEFAULT NULL,

  owner_id          BIGINT UNSIGNED NOT NULL,
  task_id           BIGINT UNSIGNED DEFAULT NULL,  -- optional attachment to task

  checksum_sha256   CHAR(64) DEFAULT NULL,
  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),

  is_public         BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_res_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_res_task  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,

  INDEX idx_res_type (resource_type),
  INDEX idx_res_owner (owner_id, deleted_at),
  INDEX idx_res_task (task_id),
  INDEX idx_res_rd (rd_id),
  FULLTEXT KEY ft_res_search (name, description)
) ENGINE=InnoDB;


-- =====================================================================
-- 5. MESSAGES
-- =====================================================================

CREATE TABLE messages (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- MSG-2024-00001

  sender_id         BIGINT UNSIGNED NOT NULL,

  -- Polymorphic parent: discussion OR chat
  parent_type       ENUM('discussion','chat') NOT NULL,
  parent_id         BIGINT UNSIGNED NOT NULL,

  body              TEXT NOT NULL,
  body_format       ENUM('plain','markdown','html') NOT NULL DEFAULT 'markdown',

  attachments       JSON NOT NULL DEFAULT (JSON_ARRAY()),
  mentions          JSON NOT NULL DEFAULT (JSON_ARRAY()),

  is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at         DATETIME DEFAULT NULL,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT,

  INDEX idx_msg_parent (parent_type, parent_id, created_at),
  INDEX idx_msg_sender (sender_id, created_at DESC),
  FULLTEXT KEY ft_msg_search (body)
) ENGINE=InnoDB;


-- =====================================================================
-- 6. DISCUSSIONS
-- =====================================================================

CREATE TABLE discussions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- DSC-2024-00001

  title             VARCHAR(255) NOT NULL,
  description       TEXT DEFAULT NULL,

  -- Polymorphic target: task or resource
  target_type       ENUM('task','resource','project','general') NOT NULL DEFAULT 'general',
  target_id         BIGINT UNSIGNED DEFAULT NULL,

  created_by        BIGINT UNSIGNED NOT NULL,
  is_locked         BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,

  message_count     INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at   DATETIME DEFAULT NULL,

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_dsc_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,

  INDEX idx_dsc_target (target_type, target_id),
  INDEX idx_dsc_activity (last_message_at DESC),
  FULLTEXT KEY ft_dsc_search (title, description)
) ENGINE=InnoDB;


-- =====================================================================
-- 7. GITHUB EVENTS
-- =====================================================================

CREATE TABLE github_events (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vee_id            VARCHAR(64) NOT NULL UNIQUE,   -- VEE-<event_id>

  event_type        ENUM(
                      'push','pull_request','issue','issue_comment',
                      'review','release','fork','star','workflow_run'
                    ) NOT NULL,
  action            VARCHAR(40) DEFAULT NULL,      -- opened, closed, merged

  repo_full_name    VARCHAR(255) NOT NULL,         -- owner/repo
  ref               VARCHAR(255) DEFAULT NULL,     -- branch / tag
  commit_sha        CHAR(40) DEFAULT NULL,

  actor_username    VARCHAR(120) DEFAULT NULL,
  actor_avatar_url  VARCHAR(500) DEFAULT NULL,

  payload           JSON NOT NULL,                 -- raw webhook payload

  -- Optional linkage to DevTeam-Hub entities
  linked_task_id    BIGINT UNSIGNED DEFAULT NULL,
  linked_user_id    BIGINT UNSIGNED DEFAULT NULL,
  linked_discussion_id BIGINT UNSIGNED DEFAULT NULL,

  event_at          DATETIME NOT NULL,
  received_at       DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  CONSTRAINT fk_gh_task FOREIGN KEY (linked_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  CONSTRAINT fk_gh_user FOREIGN KEY (linked_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_gh_dsc  FOREIGN KEY (linked_discussion_id) REFERENCES discussions(id) ON DELETE SET NULL,

  INDEX idx_gh_event (event_type, action),
  INDEX idx_gh_repo (repo_full_name, event_at DESC),
  INDEX idx_gh_actor (actor_username),
  INDEX idx_gh_task (linked_task_id)
) ENGINE=InnoDB;


-- =====================================================================
-- 8. COMMENTS
-- =====================================================================

CREATE TABLE comments (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- CMT-2024-00001

  author_id         BIGINT UNSIGNED NOT NULL,
  parent_id         BIGINT UNSIGNED DEFAULT NULL,  -- threaded comments

  -- Polymorphic target
  entity_type       ENUM('task','resource','discussion','message','github_event')
                    NOT NULL,
  entity_id         BIGINT UNSIGNED NOT NULL,

  body              TEXT NOT NULL,
  mentions          JSON NOT NULL DEFAULT (JSON_ARRAY()),

  is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at         DATETIME DEFAULT NULL,
  is_resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by       BIGINT UNSIGNED DEFAULT NULL,
  resolved_at       DATETIME DEFAULT NULL,

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_cmt_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmt_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
  CONSTRAINT fk_cmt_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_cmt_entity (entity_type, entity_id, created_at),
  INDEX idx_cmt_thread (parent_id),
  INDEX idx_cmt_unresolved (is_resolved, deleted_at),
  FULLTEXT KEY ft_cmt_search (body)
) ENGINE=InnoDB;


-- =====================================================================
-- 9. CHATS
-- =====================================================================

CREATE TABLE chats (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- CHT-2024-00001

  name              VARCHAR(150) DEFAULT NULL,
  chat_type         ENUM('direct','group','channel') NOT NULL DEFAULT 'direct',
  description       VARCHAR(500) DEFAULT NULL,
  avatar_url        VARCHAR(500) DEFAULT NULL,

  created_by        BIGINT UNSIGNED NOT NULL,

  -- For direct chats: the other user (self_id is stored in chat_members)
  peer_user_id      BIGINT UNSIGNED DEFAULT NULL,

  is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
  is_read_only      BOOLEAN NOT NULL DEFAULT FALSE,

  last_message_at   DATETIME DEFAULT NULL,
  last_message_id   BIGINT UNSIGNED DEFAULT NULL,

  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_chat_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_chat_peer FOREIGN KEY (peer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_chat_last_msg FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL,

  INDEX idx_chat_type (chat_type, is_archived),
  INDEX idx_chat_activity (last_message_at DESC)
) ENGINE=InnoDB;


-- Chat membership with roles
CREATE TABLE chat_members (
  chat_id           BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  role              ENUM('owner','admin','member') NOT NULL DEFAULT 'member',

  joined_at         DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  last_read_at      DATETIME DEFAULT NULL,
  last_read_message_id BIGINT UNSIGNED DEFAULT NULL,

  is_muted          BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (chat_id, user_id),
  CONSTRAINT fk_cm_chat FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_last_msg FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL,

  INDEX idx_cm_user (user_id, joined_at DESC),
  INDEX idx_cm_unread (user_id, last_read_at)
) ENGINE=InnoDB;


-- =====================================================================
-- 10. NOTIFICATIONS
-- =====================================================================

CREATE TABLE notifications (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),

  recipient_id      BIGINT UNSIGNED NOT NULL,
  actor_id          BIGINT UNSIGNED DEFAULT NULL,

  notification_type ENUM(
                      'task_assigned','task_completed','task_comment',
                      'message_received','chat_mention','discussion_reply',
                      'github_event','resource_shared','permission_granted',
                      'system'
                    ) NOT NULL,

  title             VARCHAR(255) NOT NULL,
  body              TEXT DEFAULT NULL,

  -- Polymorphic reference to the triggering entity
  entity_type       VARCHAR(50) DEFAULT NULL,
  entity_id         BIGINT UNSIGNED DEFAULT NULL,

  action_url        VARCHAR(500) DEFAULT NULL,
  payload           JSON NOT NULL DEFAULT (JSON_OBJECT()),

  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  read_at           DATETIME DEFAULT NULL,

  -- Delivery channels
  channels_sent     JSON NOT NULL DEFAULT (JSON_ARRAY('in_app')),
  delivered_at      DATETIME DEFAULT NULL,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  expires_at        DATETIME DEFAULT NULL,

  CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_notif_recipient (recipient_id, is_read, created_at DESC),
  INDEX idx_notif_entity (entity_type, entity_id),
  INDEX idx_notif_type (notification_type, created_at DESC)
) ENGINE=InnoDB;


-- =====================================================================
-- 11. SESSIONS
-- =====================================================================

CREATE TABLE sessions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  session_token     CHAR(64) NOT NULL UNIQUE,      -- SHA-256 hex

  user_id           BIGINT UNSIGNED NOT NULL,

  -- Client info
  ip_address        VARBINARY(16) DEFAULT NULL,
  user_agent        VARCHAR(500) DEFAULT NULL,
  device_type       ENUM('desktop','mobile','tablet','api','unknown')
                    NOT NULL DEFAULT 'unknown',
  device_name       VARCHAR(120) DEFAULT NULL,

  -- Location (optional, from IP lookup)
  country_code      CHAR(2) DEFAULT NULL,
  city              VARCHAR(120) DEFAULT NULL,

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at        DATETIME DEFAULT NULL,
  revoked_reason    VARCHAR(120) DEFAULT NULL,

  expires_at        DATETIME NOT NULL,
  last_activity_at  DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

  INDEX idx_sess_user (user_id, is_active, last_activity_at DESC),
  INDEX idx_sess_token (session_token),
  INDEX idx_sess_expires (expires_at)
) ENGINE=InnoDB;


-- =====================================================================
-- 12. TAGS
-- =====================================================================

CREATE TABLE tags (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  vdd_id            VARCHAR(32) NOT NULL UNIQUE,   -- TAG-2024-00001

  name              VARCHAR(80) NOT NULL,
  slug              VARCHAR(80) NOT NULL UNIQUE,
  description       VARCHAR(255) DEFAULT NULL,

  color_hex         CHAR(7) NOT NULL DEFAULT '#64748b',
  category          ENUM('general','priority','status','team','technology','custom')
                    NOT NULL DEFAULT 'general',

  usage_count       INT UNSIGNED NOT NULL DEFAULT 0,
  created_by        BIGINT UNSIGNED DEFAULT NULL,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_tag_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE KEY uq_tag_name (name),
  INDEX idx_tag_category (category),
  INDEX idx_tag_usage (usage_count DESC),
  FULLTEXT KEY ft_tag_search (name, description)
) ENGINE=InnoDB;


-- Generic polymorphic tagging
CREATE TABLE tag_assignments (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag_id            BIGINT UNSIGNED NOT NULL,
  entity_type       ENUM('task','resource','discussion','chat','message','github_event')
                    NOT NULL,
  entity_id         BIGINT UNSIGNED NOT NULL,
  assigned_by       BIGINT UNSIGNED DEFAULT NULL,
  assigned_at       DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  CONSTRAINT fk_ta_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_user FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE KEY uq_tag_entity (tag_id, entity_type, entity_id),
  INDEX idx_ta_entity (entity_type, entity_id)
) ENGINE=InnoDB;


-- =====================================================================
-- AUDIT LOG (cross-cutting)
-- =====================================================================

CREATE TABLE audit_log (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  user_id           BIGINT UNSIGNED DEFAULT NULL,

  table_name        VARCHAR(64) NOT NULL,
  record_id         BIGINT UNSIGNED NOT NULL,
  action            ENUM('INSERT','UPDATE','DELETE','RESTORE') NOT NULL,

  changes_json      JSON DEFAULT NULL,
  old_values_json   JSON DEFAULT NULL,
  new_values_json   JSON DEFAULT NULL,

  ip_address        VARBINARY(16) DEFAULT NULL,
  user_agent        VARCHAR(255) DEFAULT NULL,
  request_id        VARCHAR(64) DEFAULT NULL,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  INDEX idx_audit_record (table_name, record_id, created_at DESC),
  INDEX idx_audit_user (user_id, created_at DESC),
  INDEX idx_audit_action (action, created_at DESC)
) ENGINE=InnoDB
  COMMENT='Immutable audit trail, partitioned by year'
  PARTITION BY RANGE (YEAR(created_at))
  (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p_future VALUES LESS THAN MAXVALUE
  );


-- =====================================================================
-- VIEWS
-- =====================================================================

-- User activity dashboard
CREATE OR REPLACE VIEW v_user_activity AS
SELECT
  u.id,
  u.vdd_id,
  u.username,
  u.full_name,
  (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status <> 'done') AS open_tasks,
  (SELECT COUNT(*) FROM tasks t WHERE t.reporter_id = u.id) AS reported_tasks,
  (SELECT COUNT(*) FROM resources r WHERE r.owner_id = u.id AND r.deleted_at IS NULL) AS resources,
  (SELECT COUNT(*) FROM chat_members cm WHERE cm.user_id = u.id) AS chats,
  (SELECT COUNT(*) FROM notifications n WHERE n.recipient_id = u.id AND n.is_read = FALSE) AS unread_notifications,
  (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.is_active = TRUE) AS active_sessions,
  u.last_login_at
FROM users u
WHERE u.deleted_at IS NULL;


-- Task with aggregated metadata
CREATE OR REPLACE VIEW v_task_overview AS
SELECT
  t.id,
  t.vdd_id,
  t.title,
  t.status,
  t.priority,
  t.due_at,
  reporter.full_name AS reporter_name,
  assignee.full_name AS assignee_name,
  (SELECT COUNT(*) FROM comments c WHERE c.entity_type = 'task' AND c.entity_id = t.id) AS comment_count,
  (SELECT COUNT(*) FROM resources r WHERE r.task_id = t.id) AS attachment_count,
  (SELECT COUNT(*) FROM tag_assignments ta WHERE ta.entity_type = 'task' AND ta.entity_id = t.id) AS tag_count,
  t.updated_at
FROM tasks t
LEFT JOIN users reporter ON reporter.id = t.reporter_id
LEFT JOIN users assignee ON assignee.id = t.assignee_id
WHERE t.deleted_at IS NULL;


-- Unread notification summary per user
CREATE OR REPLACE VIEW v_notification_summary AS
SELECT
  recipient_id,
  notification_type,
  COUNT(*) AS count,
  MAX(created_at) AS latest_at
FROM notifications
WHERE is_read = FALSE
  AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
GROUP BY recipient_id, notification_type;


-- =====================================================================
-- TRIGGERS
-- =====================================================================

DELIMITER $$

-- Auto-bump row_version on users update
CREATE TRIGGER trg_users_version_bump
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  SET NEW.row_version = OLD.row_version + 1;
END$$

-- Auto-bump row_version on tasks update
CREATE TRIGGER trg_tasks_version_bump
BEFORE UPDATE ON tasks
FOR EACH ROW
BEGIN
  SET NEW.row_version = OLD.row_version + 1;
  SET NEW.updated_at = UTC_TIMESTAMP();
END$$

-- Track message edits
CREATE TRIGGER trg_messages_edited
BEFORE UPDATE ON messages
FOR EACH ROW
BEGIN
  IF OLD.body <> NEW.body THEN
    SET NEW.is_edited = TRUE;
    SET NEW.edited_at = UTC_TIMESTAMP();
  END IF;
END$$

-- Track comment edits
CREATE TRIGGER trg_comments_edited
BEFORE UPDATE ON comments
FOR EACH ROW
BEGIN
  IF OLD.body <> NEW.body THEN
    SET NEW.is_edited = TRUE;
    SET NEW.edited_at = UTC_TIMESTAMP();
  END IF;
END$$

-- Auto-update chat last_message_at when a message is inserted
CREATE TRIGGER trg_messages_update_chat
AFTER INSERT ON messages
FOR EACH ROW
BEGIN
  IF NEW.parent_type = 'chat' THEN
    UPDATE chats
       SET last_message_at = NEW.created_at,
           last_message_id = NEW.id
     WHERE id = NEW.parent_id;
  ELSEIF NEW.parent_type = 'discussion' THEN
    UPDATE discussions
       SET message_count = message_count + 1,
           last_message_at = NEW.created_at
     WHERE id = NEW.parent_id;
  END IF;
END$$

DELIMITER ;


-- =====================================================================
-- STORED PROCEDURES
-- =====================================================================

DELIMITER $$

-- Fetch inbox for a user (unread notifications, newest first)
CREATE PROCEDURE sp_user_inbox(
  IN p_user_id BIGINT,
  IN p_limit   INT
)
BEGIN
  SELECT
    n.uuid,
    n.notification_type,
    n.title,
    n.body,
    n.action_url,
    n.created_at,
    u.full_name AS actor_name
  FROM notifications n
  LEFT JOIN users u ON u.id = n.actor_id
  WHERE n.recipient_id = p_user_id
    AND n.is_read = FALSE
    AND (n.expires_at IS NULL OR n.expires_at > UTC_TIMESTAMP())
  ORDER BY n.created_at DESC
  LIMIT p_limit;
END$$

-- Load a full discussion thread with messages and authors
CREATE PROCEDURE sp_discussion_thread(
  IN p_discussion_id BIGINT
)
BEGIN
  SELECT
    m.vdd_id,
    m.body,
    m.created_at,
    u.username,
    u.full_name,
    u.avatar_url
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  WHERE m.parent_type = 'discussion'
    AND m.parent_id = p_discussion_id
    AND m.is_deleted = FALSE
  ORDER BY m.created_at ASC;
END$$

-- User dashboard counters
CREATE PROCEDURE sp_user_dashboard(IN p_user_id BIGINT)
BEGIN
  SELECT
    (SELECT COUNT(*) FROM tasks WHERE assignee_id = p_user_id AND status <> 'done') AS open_tasks,
    (SELECT COUNT(*) FROM notifications WHERE recipient_id = p_user_id AND is_read = FALSE) AS unread_notifications,
    (SELECT COUNT(*) FROM chat_members WHERE user_id = p_user_id) AS chat_count,
    (SELECT COUNT(*) FROM sessions WHERE user_id = p_user_id AND is_active = TRUE) AS active_sessions,
    (SELECT COUNT(*) FROM resources WHERE owner_id = p_user_id AND deleted_at IS NULL) AS resource_count;
END$$

DELIMITER ;


-- =====================================================================
-- SEED DATA
-- =====================================================================

-- Users
INSERT INTO users (vdd_id, username, email, full_name, password_hash, status) VALUES
('USR-2024-00001', 'abebe', 'abebe@devteam.io', 'Abebe Kebede', '$2y$12$...', 'active'),
('USR-2024-00002', 'sara',  'sara@devteam.io',  'Sara Tesfaye', '$2y$12$...', 'active'),
('USR-2024-00003', 'dawit', 'dawit@devteam.io', 'Dawit Haile',  '$2y$12$...', 'active'),
('USR-2024-00004', 'hana',  'hana@devteam.io',  'Hana Girma',   '$2y$12$...', 'active');

-- Permissions for each user (grant global read + task write)
INSERT INTO user_permissions (user_id, permission_id, scope_type)
SELECT 1, id, 'global' FROM permissions WHERE name IN ('admin.all','task.create','task.update')
UNION ALL
SELECT 2, id, 'global' FROM permissions WHERE name IN ('task.read','task.update','comment.create')
UNION ALL
SELECT 3, id, 'global' FROM permissions WHERE name IN ('task.read','resource.create')
UNION ALL
SELECT 4, id, 'global' FROM permissions WHERE name IN ('task.read','comment.create');

-- Tasks
INSERT INTO tasks (vdd_id, title, description, status, priority, reporter_id, assignee_id, due_at) VALUES
('TSK-2024-00001', 'Design login page',       'Create wireframes for the login flow', 'in_progress', 'high',   1, 2, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY)),
('TSK-2024-00002', 'Fix session timeout bug', 'Session expires too early',            'todo',        'urgent', 3, 3, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 DAY)),
('TSK-2024-00003', 'Write API docs',          'Document all public endpoints',        'backlog',     'medium', 1, 4, NULL);

-- Tags
INSERT INTO tags (vdd_id, name, slug, color_hex, category, created_by) VALUES
('TAG-2024-00001', 'Frontend',   'frontend',   '#2563eb', 'technology', 1),
('TAG-2024-00002', 'Backend',    'backend',    '#0d9488', 'technology', 1),
('TAG-2024-00003', 'Bug',        'bug',        '#881337', 'status',     1),
('TAG-2024-00004', 'Design',     'design',     '#d97706', 'team',       1);

-- Task ↔ Tag assignments
INSERT INTO tag_assignments (tag_id, entity_type, entity_id, assigned_by) VALUES
(1, 'task', 1, 1),
(2, 'task', 2, 3),
(3, 'task', 2, 3),
(4, 'task', 1, 1);

-- Discussion linked to task 1
INSERT INTO discussions (vdd_id, title, description, target_type, target_id, created_by) VALUES
('DSC-2024-00001', 'Login page redesign', 'Let''s discuss the new design', 'task', 1, 1);

-- Messages in the discussion
INSERT INTO messages (vdd_id, sender_id, parent_type, parent_id, body) VALUES
('MSG-2024-00001', 1, 'discussion', 1, 'Starting the wireframes today.'),
('MSG-2024-00002', 2, 'discussion', 1, 'Great! I''ll review once ready.');

-- Chat (direct)
INSERT INTO chats (vdd_id, chat_type, created_by, peer_user_id, name) VALUES
('CHT-2024-00001', 'direct', 1, 2, NULL);

INSERT INTO chat_members (chat_id, user_id, role) VALUES
(1, 1, 'owner'),
(1, 2, 'member');

INSERT INTO messages (vdd_id, sender_id, parent_type, parent_id, body) VALUES
('MSG-2024-00003', 1, 'chat', 1, 'Hey Sara, can you review PR #42?'),
('MSG-2024-00004', 2, 'chat', 1, 'Sure! Looking now.');

-- Resource
INSERT INTO resources (vdd_id, rd_id, name, resource_type, mime_type, size_bytes, storage_path, owner_id, task_id) VALUES
('RSC-2024-00001', 'RD-00001', 'login-wireframe-v1.png', 'image', 'image/png', 245760, '/uploads/2024/login-wireframe-v1.png', 2, 1);

-- Comments on task 1
INSERT INTO comments (vdd_id, author_id, entity_type, entity_id, body) VALUES
('CMT-2024-00001', 3, 'task', 1, 'Looking good — just needs a11y review.'),
('CMT-2024-00002', 4, 'task', 1, 'I''ll handle the color contrast check.');

-- GitHub events
INSERT INTO github_events (vee_id, event_type, action, repo_full_name, ref, commit_sha, actor_username, payload, linked_task_id, event_at) VALUES
('VEE-00001', 'pull_request', 'opened', 'devteam/login-ui', 'feature/wireframe',
 'abc123def4567890abc123def4567890abc12345', 'abebe', JSON_OBJECT('pr_number', 42, 'title', 'Add login wireframe'),
 1, UTC_TIMESTAMP()),
('VEE-00002', 'push', NULL, 'devteam/login-ui', 'main',
 'def456abc1237890def456abc1237890def456ab', 'sara', JSON_OBJECT('commits', 3),
 1, UTC_TIMESTAMP());

-- Notifications
INSERT INTO notifications (recipient_id, actor_id, notification_type, title, body, entity_type, entity_id, action_url) VALUES
(2, 1, 'task_assigned',    'New task assigned',  'Design login page has been assigned to you', 'task', 1, '/tasks/1'),
(1, 3, 'task_comment',     'New comment on task','Dawit commented on Design login page',     'task', 1, '/tasks/1'),
(2, 1, 'message_received', 'New chat message',   'Abebe sent you a message',                  'chat', 1, '/chats/1'),
(3, 1, 'github_event',     'PR opened',          'PR #42 opened on devteam/login-ui',         'github_event', 1, '/github/1');

-- Session
INSERT INTO sessions (session_token, user_id, ip_address, user_agent, device_type, device_name, expires_at) VALUES
(SHA2('demo-token-abebe', 256), 1, INET6_ATON('196.188.1.1'), 'Mozilla/5.0 (Macintosh)', 'desktop', 'MacBook Pro', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY)),
(SHA2('demo-token-sara',  256), 2, INET6_ATON('196.188.1.2'), 'Mozilla/5.0 (iPhone)',    'mobile',  'iPhone 15',   DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY));


-- =====================================================================
-- END OF SCHEMA
-- =====================================================================