-- ============================================================================
-- DEVTEAM-HUB FINAL DATABASE SCHEMA (22 tables)
-- Base schema + migration 002 merged into one file.
-- ============================================================================
CREATE DATABASE IF NOT EXISTS devteam_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE devteam_hub;

-- Temporarily disable foreign key checks for clean recreation
SET foreign_key_checks = 0;

-- ============================================================================
-- 1. USERS TABLE (NO ROLES - PURE IDENTITY ONLY)
-- ============================================================================
DROP TABLE IF EXISTS user_skills;
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL UNIQUE,                -- UUID v4 exposed to API clients to prevent ID enumeration
    username VARCHAR(50) NOT NULL UNIQUE,               -- Unique platform username
    email VARCHAR(191) NOT NULL UNIQUE,                 -- 191 chars fits maximum UTF8MB4 index byte limit
    password_hash VARCHAR(255) NOT NULL,                -- Argon2id or Bcrypt hash
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    job_title VARCHAR(100) NULL,                        -- "Frontend Developer" shown on cards and Live Pulse
    status ENUM('ACTIVE', 'SUSPENDED', 'PENDING_ONBOARDING') NOT NULL DEFAULT 'PENDING_ONBOARDING',
    bio VARCHAR(500) NULL,                              -- Member editable bio
    current_focus VARCHAR(150) NULL,                    -- "Working on UI components"
    avatar_url VARCHAR(2048) NULL,                      -- Secure S3/CDN object path
    social_links JSON NULL,                             -- {"github":"","linkedin":"","x":""}
    last_active_at DATETIME NULL,                       -- Powers the real-time "Live Pulse" glowing indicator
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_users_status (status),
    INDEX idx_users_pulse (last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: profile skill chips (React, Node.js, ...)
CREATE TABLE user_skills (
    user_id BIGINT UNSIGNED NOT NULL,
    skill VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, skill),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 2. PURE PERMISSION ENGINE (DIRECT USER ASSIGNMENT)
-- ============================================================================
DROP TABLE IF EXISTS user_permissions;
DROP TABLE IF EXISTS permissions;

CREATE TABLE permissions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,                  -- e.g., 'task:delete', 'resource:toggle_visibility'
    module VARCHAR(50) NOT NULL,                        -- Grouping: 'TASKS', 'RESOURCES', 'USERS', 'CHAT'
    description VARCHAR(255) NOT NULL,                  -- Display text for the Admin toggle checklist
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_permissions_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE user_permissions (
    user_id BIGINT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    granted_by BIGINT UNSIGNED NULL,                    -- NULL for root bootstrap admin; tracks grantor for audit
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, permission_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_user_perm_lookup (permission_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 3. SESSIONS (AUTH TOKEN SECURITY)
-- ============================================================================
DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    refresh_token_hash CHAR(64) NOT NULL UNIQUE,        -- SHA-256 digest of rotating refresh token
    ip_address VARCHAR(45) NOT NULL,                    -- IPv4 and IPv6 support
    user_agent VARCHAR(512) NOT NULL,                   -- Client browser / device fingerprint
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,          -- Allows instant revocation of a single device
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_sessions_active (user_id, is_revoked, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 4. TAGS
-- ============================================================================
DROP TABLE IF EXISTS task_tags;
DROP TABLE IF EXISTS tags;
CREATE TABLE tags (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,                   -- e.g., 'API', 'Docs', 'UI'
    color_hex CHAR(7) NOT NULL DEFAULT '#6366F1',       -- UI hex badge color
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 5. RESOURCES & RESOURCE TAGS
-- ============================================================================
DROP TABLE IF EXISTS resource_tags;
DROP TABLE IF EXISTS resources;

CREATE TABLE resources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    file_type ENUM('PDF', 'DOC', 'IMAGE', 'ARCHIVE', 'CODE', 'LINK', 'OTHER') NOT NULL,
    file_url VARCHAR(2048) NOT NULL,
    file_size_bytes BIGINT UNSIGNED NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,           -- Guest access: Guests ONLY see is_public = TRUE
    security_badge ENUM('PUBLIC', 'INTERNAL', 'RESTRICTED') NOT NULL DEFAULT 'INTERNAL',
    uploaded_by BIGINT UNSIGNED NOT NULL,
    download_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE RESTRICT,
    INDEX idx_resources_guest (is_public, created_at DESC),
    INDEX idx_resources_uploader (uploaded_by, created_at DESC),
    FULLTEXT INDEX idx_ft_resources (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE resource_tags (
    resource_id BIGINT UNSIGNED NOT NULL,
    tag_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (resource_id, tag_id),
    FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE,
    INDEX idx_resource_tags_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 6. TASKS (KANBAN BOARD ENGINE)
-- ============================================================================
DROP TABLE IF EXISTS subtasks;
DROP TABLE IF EXISTS task_comments;
DROP TABLE IF EXISTS tasks;
CREATE TABLE tasks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_code VARCHAR(20) NOT NULL UNIQUE,              -- Formatted display code (e.g., 'DEV-101')
    title VARCHAR(255) NOT NULL,
    description LONGTEXT NULL,
    status ENUM('UNDONE', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'UNDONE',
    priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    is_public BOOLEAN NOT NULL DEFAULT FALSE,           -- Guests ONLY see is_public = TRUE
    position DECIMAL(10, 4) NOT NULL DEFAULT 65535.0000,-- Fractional indexing: O(1) drag & drop reordering
    due_date DATE NULL,
    assignee_id BIGINT UNSIGNED NULL,                   -- Assigned team member
    created_by BIGINT UNSIGNED NOT NULL,                -- Task creator
    completed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (assignee_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    INDEX idx_tasks_kanban (status, position),
    INDEX idx_tasks_my_work (assignee_id, status),
    INDEX idx_tasks_due_date (due_date),
    INDEX idx_tasks_guest (is_public, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: task tags (#Backend, #API on Kanban cards)
CREATE TABLE task_tags (
    task_id BIGINT UNSIGNED NOT NULL,
    tag_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (task_id, tag_id),
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE,
    INDEX idx_task_tags_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: subtask checklist ("2 / 4")
CREATE TABLE subtasks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    position DECIMAL(10, 4) NOT NULL DEFAULT 65535.0000,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    INDEX idx_subtasks_task (task_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: task comment thread
CREATE TABLE task_comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    author_id BIGINT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE RESTRICT,
    INDEX idx_task_comments_task (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 7. TASK GITHUB EVENTS (WEBHOOK INTEGRATION)
-- ============================================================================
DROP TABLE IF EXISTS task_github_events;
CREATE TABLE task_github_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT UNSIGNED NOT NULL,
    event_type ENUM('COMMIT', 'PULL_REQUEST') NOT NULL,
    external_ref VARCHAR(100) NOT NULL,                 -- Commit SHA or PR number (e.g., 'PR#42')
    repository_name VARCHAR(150) NOT NULL,
    branch_name VARCHAR(100) NULL,
    action VARCHAR(50) NOT NULL,                        -- 'opened', 'merged', 'pushed', 'closed'
    title VARCHAR(255) NOT NULL,                        -- Commit message or PR title
    author_username VARCHAR(100) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    payload_snapshot JSON NULL,                         -- Auditing payload directly from GitHub
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    UNIQUE KEY uq_task_github_event (task_id, event_type, external_ref),
    INDEX idx_github_events_task (task_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 8. CHATS & MESSAGES (REAL-TIME ENGINE)
-- ============================================================================
DROP TABLE IF EXISTS chat_pins;
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS chat_members;
DROP TABLE IF EXISTS chats;

CREATE TABLE chats (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,                         -- Channel name (e.g., '#general') or DM display title
    type ENUM('PUBLIC_CHANNEL', 'PRIVATE_CHANNEL', 'DIRECT_MESSAGE') NOT NULL DEFAULT 'PUBLIC_CHANNEL',
    created_by BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE chat_members (
    chat_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    last_read_message_id BIGINT UNSIGNED NULL,          -- O(1) unread watermark pointer
    is_muted BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    chat_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    attachment_url VARCHAR(2048) NULL,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at DATETIME NULL,                           -- Soft delete for UI thread continuity
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE RESTRICT,
    INDEX idx_messages_chronology (chat_id, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: emoji reactions on messages
CREATE TABLE message_reactions (
    message_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NEW: pinned chat messages
CREATE TABLE chat_pins (
    chat_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    pinned_by BIGINT UNSIGNED NULL,
    pinned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chat_id, message_id),
    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE,
    FOREIGN KEY (pinned_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 9. DISCUSSIONS & COMMENTS
-- ============================================================================
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS discussions;

CREATE TABLE discussions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(36) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    author_id BIGINT UNSIGNED NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    view_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE RESTRICT,
    INDEX idx_discussions_feed (is_pinned DESC, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE comments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    discussion_id BIGINT UNSIGNED NOT NULL,
    author_id BIGINT UNSIGNED NOT NULL,
    parent_id BIGINT UNSIGNED NULL,                     -- Self-reference for threaded discussions
    content TEXT NOT NULL,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (discussion_id) REFERENCES discussions (id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE RESTRICT,
    FOREIGN KEY (parent_id) REFERENCES comments (id) ON DELETE CASCADE,
    INDEX idx_comments_hierarchy (discussion_id, created_at ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 10. NOTIFICATIONS
-- ============================================================================
DROP TABLE IF EXISTS notifications;
CREATE TABLE notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recipient_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NULL,                      -- NULL for automated GitHub webhook alerts
    type ENUM(
        'TASK_ASSIGNED',
        'TASK_MOVED',
        'GITHUB_PR_LINKED',
        'ADMIN_ONBOARDING',
        'CHAT_MENTION',
        'SYSTEM_ALERT'
    ) NOT NULL,
    title VARCHAR(150) NOT NULL,
    body VARCHAR(500) NOT NULL,
    action_url VARCHAR(2048) NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    sound_alert_played BOOLEAN NOT NULL DEFAULT FALSE,  -- In-app sound notification flag
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_notifications_stream (recipient_id, is_read, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ============================================================================
-- 11. ACTIVITY LOG (Activity Stream, My Activities, Live Activity)
-- ============================================================================
DROP TABLE IF EXISTS activity_log;
CREATE TABLE activity_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_id BIGINT UNSIGNED NULL,                      -- NULL for system events
    type ENUM('TASK_UPDATED', 'TASK_ASSIGNED', 'TASK_COMMENTED', 'GITHUB_COMMIT',
              'PR_COMMENT', 'RESOURCE_ADDED', 'DISCUSSION_CREATED',
              'PROFILE_UPDATED', 'SYSTEM') NOT NULL,
    entity_type ENUM('TASK', 'RESOURCE', 'DISCUSSION', 'USER', 'CHAT', 'SYSTEM') NOT NULL,
    entity_ref VARCHAR(100) NULL,                       -- task_code or public_id
    summary VARCHAR(255) NOT NULL,                      -- "moved task #15 to Done"
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_activity_stream (created_at DESC),
    INDEX idx_activity_actor (actor_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Re-enable relational constraint checks
SET foreign_key_checks = 1;