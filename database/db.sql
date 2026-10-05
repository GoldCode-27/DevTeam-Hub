-- =============================================================
-- DevTeam-Hub -  MySQL Database Schema v1.0
-- Target: MySQL 8.0+
-- Current scope: Auth, RBAC, Teams, Tasks/Kanban, Resources,
-- Chat, Discussions, Notifications, Activities, GitHub metadata.
-- Future scope intentionally NOT implemented here: GitHub webhooks.
-- =============================================================

CREATE DATABASE IF NOT EXISTS devteam_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE devteam_hub;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS task_pull_requests;
DROP TABLE IF EXISTS task_commits;
DROP TABLE IF EXISTS github_pull_requests;
DROP TABLE IF EXISTS github_commits;
DROP TABLE IF EXISTS github_repositories;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS message_reads;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversation_members;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS discussion_comments;
DROP TABLE IF EXISTS discussions;
DROP TABLE IF EXISTS task_dependencies;
DROP TABLE IF EXISTS task_history;
DROP TABLE IF EXISTS task_comments;
DROP TABLE IF EXISTS task_labels;
DROP TABLE IF EXISTS labels;
DROP TABLE IF EXISTS task_assignments;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS task_statuses;
DROP TABLE IF EXISTS resource_tags;
DROP TABLE IF EXISTS resource_tag_map;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 1. USERS
-- Guest is NOT stored as a user. Guest is an unauthenticated
-- application state. Only authenticated team accounts live here.
-- =============================================================
CREATE TABLE users (
    id CHAR(36) NOT NULL,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(1000) NULL,
    bio TEXT NULL,
    job_title VARCHAR(150) NULL,
    github_username VARCHAR(100) NULL,
    account_status ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    email_verified_at DATETIME(6) NULL,
    last_login_at DATETIME(6) NULL,
    last_seen_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    UNIQUE KEY uq_users_github_username (github_username),
    KEY idx_users_status (account_status),
    KEY idx_users_last_seen (last_seen_at)
) ENGINE=InnoDB;

-- =============================================================
-- 2. RBAC
-- ADMIN and MEMBER are seeded below. GUEST is intentionally not
-- a database role because guest access is unauthenticated/public.
-- =============================================================
CREATE TABLE roles (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    is_system_role BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB;

CREATE TABLE permissions (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(255) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_permissions_code (code)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
    role_id SMALLINT UNSIGNED NOT NULL,
    permission_id SMALLINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE user_roles (
    user_id CHAR(36) NOT NULL,
    role_id SMALLINT UNSIGNED NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_role
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 3. AUTHENTICATION / SESSIONS
-- Store hashes of refresh/session tokens, not raw long-lived tokens.
-- =============================================================
CREATE TABLE user_sessions (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    device_name VARCHAR(255) NULL,
    user_agent VARCHAR(1000) NULL,
    ip_address VARBINARY(16) NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    last_used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_sessions_token_hash (token_hash),
    KEY idx_user_sessions_user (user_id),
    KEY idx_user_sessions_expires (expires_at),
    CONSTRAINT fk_user_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_reset_tokens (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_password_reset_token_hash (token_hash),
    KEY idx_password_reset_user (user_id),
    KEY idx_password_reset_expires (expires_at),
    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE email_verification_tokens (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_email_verification_token_hash (token_hash),
    KEY idx_email_verification_user (user_id),
    KEY idx_email_verification_expires (expires_at),
    CONSTRAINT fk_email_verification_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 4. TEAMS
-- Current product has one engineering team concept, but this
-- supports multiple teams without redesign.
-- =============================================================
CREATE TABLE teams (
    id CHAR(36) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_teams_name (name),
    KEY idx_teams_created_by (created_by),
    CONSTRAINT fk_teams_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE team_members (
    team_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    left_at DATETIME(6) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (team_id, user_id),
    KEY idx_team_members_user (user_id),
    KEY idx_team_members_active (team_id, is_active),
    CONSTRAINT fk_team_members_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_team_members_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 5. PROJECTS
-- Not heavily exposed by the current UI, but retained as a clean
-- optional domain because tasks/resources can later be grouped by
-- project without changing the task model.
-- =============================================================
CREATE TABLE projects (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    project_key VARCHAR(20) NOT NULL,
    description TEXT NULL,
    status ENUM('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    created_by CHAR(36) NOT NULL,
    start_date DATE NULL,
    target_date DATE NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    archived_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_projects_team_key (team_id, project_key),
    KEY idx_projects_team_status (team_id, status),
    CONSTRAINT fk_projects_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_projects_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE project_members (
    project_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    project_role ENUM('OWNER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (project_id, user_id),
    KEY idx_project_members_user (user_id),
    CONSTRAINT fk_project_members_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_project_members_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 6. RESOURCES
-- Files live outside MySQL. MySQL stores metadata and access state.
-- =============================================================
CREATE TABLE resources (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NULL,
    project_id CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    original_file_name VARCHAR(500) NOT NULL,
    storage_key VARCHAR(1000) NOT NULL,
    public_url VARCHAR(1500) NULL,
    mime_type VARCHAR(150) NOT NULL,
    file_size_bytes BIGINT UNSIGNED NULL,
    checksum_sha256 CHAR(64) NULL,
    visibility ENUM('PUBLIC', 'PRIVATE', 'TEAM', 'PROJECT') NOT NULL DEFAULT 'PRIVATE',
    uploaded_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_resources_storage_key (storage_key),
    KEY idx_resources_visibility (visibility, created_at),
    KEY idx_resources_team (team_id, created_at),
    KEY idx_resources_project (project_id, created_at),
    KEY idx_resources_uploader (uploaded_by),
    CONSTRAINT fk_resources_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_resources_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_resources_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE resource_tags (
    id CHAR(36) NOT NULL,
    name VARCHAR(50) NOT NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_resource_tags_name (name),
    CONSTRAINT fk_resource_tags_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE resource_tag_map (
    resource_id CHAR(36) NOT NULL,
    tag_id CHAR(36) NOT NULL,
    PRIMARY KEY (resource_id, tag_id),
    CONSTRAINT fk_resource_tag_map_resource
        FOREIGN KEY (resource_id) REFERENCES resources(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_resource_tag_map_tag
        FOREIGN KEY (tag_id) REFERENCES resource_tags(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 7. TASKS / KANBAN
-- Statuses are data, not hardcoded ENUMs, so workflow can evolve.
-- =============================================================
CREATE TABLE task_statuses (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_task_statuses_code (code),
    KEY idx_task_statuses_position (position)
) ENGINE=InnoDB;

CREATE TABLE tasks (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NOT NULL,
    project_id CHAR(36) NULL,
    status_id SMALLINT UNSIGNED NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_by CHAR(36) NOT NULL,
    position DECIMAL(20,6) NOT NULL DEFAULT 1000.000000,
    start_date DATE NULL,
    due_date DATE NULL,
    completed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_tasks_team_status_position (team_id, status_id, position),
    KEY idx_tasks_project_status (project_id, status_id),
    KEY idx_tasks_creator (created_by),
    KEY idx_tasks_public (is_public, created_at),
    KEY idx_tasks_due_date (due_date),
    CONSTRAINT fk_tasks_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_project
        FOREIGN KEY (project_id) REFERENCES projects(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_status
        FOREIGN KEY (status_id) REFERENCES task_statuses(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_tasks_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_assignments (
    task_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    assignment_role ENUM('PRIMARY', 'CONTRIBUTOR') NOT NULL DEFAULT 'PRIMARY',
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    assigned_by CHAR(36) NULL,
    PRIMARY KEY (task_id, user_id),
    KEY idx_task_assignments_user (user_id),
    CONSTRAINT fk_task_assignments_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_assignments_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_task_assignments_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE labels (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NOT NULL,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(20) NOT NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_labels_team_name (team_id, name),
    CONSTRAINT fk_labels_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_labels_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_labels (
    task_id CHAR(36) NOT NULL,
    label_id CHAR(36) NOT NULL,
    PRIMARY KEY (task_id, label_id),
    CONSTRAINT fk_task_labels_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_labels_label
        FOREIGN KEY (label_id) REFERENCES labels(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_comments (
    id CHAR(36) NOT NULL,
    task_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    content TEXT NOT NULL,
    edited_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_task_comments_task_created (task_id, created_at),
    KEY idx_task_comments_user (user_id),
    CONSTRAINT fk_task_comments_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_comments_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_dependencies (
    task_id CHAR(36) NOT NULL,
    depends_on_task_id CHAR(36) NOT NULL,
    dependency_type ENUM('BLOCKS', 'RELATES_TO') NOT NULL DEFAULT 'BLOCKS',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (task_id, depends_on_task_id),
    CONSTRAINT chk_task_dependency_no_self CHECK (task_id <> depends_on_task_id),
    CONSTRAINT fk_task_dependencies_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_dependencies_depends_on
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_history (
    id CHAR(36) NOT NULL,
    task_id CHAR(36) NOT NULL,
    actor_user_id CHAR(36) NULL,
    event_type VARCHAR(80) NOT NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_task_history_task_created (task_id, created_at),
    KEY idx_task_history_actor (actor_user_id),
    CONSTRAINT fk_task_history_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_history_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 8. CHAT
-- Realtime transport/presence is handled by Socket.io later.
-- MySQL stores durable conversation/message state.
-- =============================================================
CREATE TABLE conversations (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NULL,
    type ENUM('DIRECT', 'GROUP', 'TEAM') NOT NULL DEFAULT 'DIRECT',
    title VARCHAR(255) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_conversations_team (team_id, updated_at),
    KEY idx_conversations_created_by (created_by),
    CONSTRAINT fk_conversations_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_conversations_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE conversation_members (
    conversation_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    left_at DATETIME(6) NULL,
    PRIMARY KEY (conversation_id, user_id),
    KEY idx_conversation_members_user (user_id),
    CONSTRAINT fk_conversation_members_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_conversation_members_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE messages (
    id CHAR(36) NOT NULL,
    conversation_id CHAR(36) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    content TEXT NOT NULL,
    message_type ENUM('TEXT', 'SYSTEM') NOT NULL DEFAULT 'TEXT',
    reply_to_message_id CHAR(36) NULL,
    edited_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_messages_conversation_created (conversation_id, created_at),
    KEY idx_messages_sender (sender_id),
    KEY idx_messages_reply (reply_to_message_id),
    CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_messages_sender
        FOREIGN KEY (sender_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_messages_reply
        FOREIGN KEY (reply_to_message_id) REFERENCES messages(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE message_reads (
    message_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    read_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (message_id, user_id),
    KEY idx_message_reads_user (user_id, read_at),
    CONSTRAINT fk_message_reads_message
        FOREIGN KEY (message_id) REFERENCES messages(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_message_reads_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 9. DISCUSSIONS
-- Persistent technical discussions are separate from realtime chat.
-- =============================================================
CREATE TABLE discussions (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NOT NULL,
    author_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_discussions_team_created (team_id, created_at),
    KEY idx_discussions_pinned (team_id, is_pinned, created_at),
    CONSTRAINT fk_discussions_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_discussions_author
        FOREIGN KEY (author_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE discussion_comments (
    id CHAR(36) NOT NULL,
    discussion_id CHAR(36) NOT NULL,
    author_id CHAR(36) NOT NULL,
    parent_comment_id CHAR(36) NULL,
    content TEXT NOT NULL,
    edited_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_discussion_comments_discussion_created (discussion_id, created_at),
    KEY idx_discussion_comments_parent (parent_comment_id),
    CONSTRAINT fk_discussion_comments_discussion
        FOREIGN KEY (discussion_id) REFERENCES discussions(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_discussion_comments_author
        FOREIGN KEY (author_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_discussion_comments_parent
        FOREIGN KEY (parent_comment_id) REFERENCES discussion_comments(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 10. NOTIFICATIONS
-- =============================================================
CREATE TABLE notifications (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    type VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message VARCHAR(1000) NULL,
    entity_type VARCHAR(80) NULL,
    entity_id CHAR(36) NULL,
    read_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_notifications_user_read_created (user_id, read_at, created_at),
    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 11. ACTIVITIES
-- Activity feed is for user-facing workspace history.
-- =============================================================
CREATE TABLE activities (
    id CHAR(36) NOT NULL,
    team_id CHAR(36) NULL,
    actor_user_id CHAR(36) NULL,
    type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id CHAR(36) NULL,
    summary VARCHAR(500) NOT NULL,
    metadata JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_activities_team_created (team_id, created_at),
    KEY idx_activities_actor_created (actor_user_id, created_at),
    KEY idx_activities_entity (entity_type, entity_id),
    CONSTRAINT fk_activities_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_activities_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 12. AUDIT LOGS
-- Security/admin audit history is intentionally separate from
-- normal activity feed.
-- =============================================================
CREATE TABLE audit_logs (
    id CHAR(36) NOT NULL,
    actor_user_id CHAR(36) NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80) NULL,
    entity_id CHAR(36) NULL,
    ip_address VARBINARY(16) NULL,
    user_agent VARCHAR(1000) NULL,
    metadata JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_audit_actor_created (actor_user_id, created_at),
    KEY idx_audit_entity (entity_type, entity_id),
    KEY idx_audit_created (created_at),
    CONSTRAINT fk_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 13. GITHUB METADATA
-- Current UI explicitly references GitHub handles, commits and PRs.
-- These tables support those current UI needs.
-- GitHub Webhook delivery/queue tables are intentionally NOT here.
-- =============================================================
CREATE TABLE github_repositories (
    id CHAR(36) NOT NULL,
    github_repository_id BIGINT UNSIGNED NOT NULL,
    owner_login VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(511) NOT NULL,
    html_url VARCHAR(1000) NOT NULL,
    default_branch VARCHAR(255) NULL,
    visibility ENUM('PUBLIC', 'PRIVATE', 'INTERNAL') NULL,
    team_id CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_github_repositories_external_id (github_repository_id),
    UNIQUE KEY uq_github_repositories_full_name (full_name),
    KEY idx_github_repositories_team (team_id),
    CONSTRAINT fk_github_repositories_team
        FOREIGN KEY (team_id) REFERENCES teams(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE github_commits (
    id CHAR(36) NOT NULL,
    repository_id CHAR(36) NOT NULL,
    sha CHAR(40) NOT NULL,
    author_login VARCHAR(255) NULL,
    author_name VARCHAR(255) NULL,
    committer_name VARCHAR(255) NULL,
    message TEXT NOT NULL,
    html_url VARCHAR(1000) NULL,
    branch_name VARCHAR(255) NULL,
    committed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_github_commits_repo_sha (repository_id, sha),
    KEY idx_github_commits_branch (repository_id, branch_name),
    KEY idx_github_commits_date (committed_at),
    CONSTRAINT fk_github_commits_repository
        FOREIGN KEY (repository_id) REFERENCES github_repositories(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE github_pull_requests (
    id CHAR(36) NOT NULL,
    repository_id CHAR(36) NOT NULL,
    github_pr_id BIGINT UNSIGNED NOT NULL,
    pr_number INT UNSIGNED NOT NULL,
    title VARCHAR(500) NOT NULL,
    body MEDIUMTEXT NULL,
    author_login VARCHAR(255) NULL,
    source_branch VARCHAR(255) NULL,
    target_branch VARCHAR(255) NULL,
    state ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    is_merged BOOLEAN NOT NULL DEFAULT FALSE,
    html_url VARCHAR(1000) NULL,
    opened_at DATETIME(6) NULL,
    closed_at DATETIME(6) NULL,
    merged_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_github_pr_external_id (github_pr_id),
    UNIQUE KEY uq_github_pr_repo_number (repository_id, pr_number),
    KEY idx_github_pr_state (repository_id, state),
    CONSTRAINT fk_github_pr_repository
        FOREIGN KEY (repository_id) REFERENCES github_repositories(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_commits (
    task_id CHAR(36) NOT NULL,
    commit_id CHAR(36) NOT NULL,
    linked_by CHAR(36) NULL,
    linked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (task_id, commit_id),
    CONSTRAINT fk_task_commits_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_commits_commit
        FOREIGN KEY (commit_id) REFERENCES github_commits(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_commits_linked_by
        FOREIGN KEY (linked_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE task_pull_requests (
    task_id CHAR(36) NOT NULL,
    pull_request_id CHAR(36) NOT NULL,
    linked_by CHAR(36) NULL,
    linked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (task_id, pull_request_id),
    CONSTRAINT fk_task_pull_requests_task
        FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_pull_requests_pr
        FOREIGN KEY (pull_request_id) REFERENCES github_pull_requests(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_task_pull_requests_linked_by
        FOREIGN KEY (linked_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 14. SEED SYSTEM DATA
-- =============================================================
INSERT INTO roles (code, name, description) VALUES
('ADMIN', 'Administrator', 'Full administrative access'),
('MEMBER', 'Member', 'Authenticated engineering team member');

INSERT INTO permissions (code, name, description) VALUES
('users.read', 'View users', 'View team members'),
('users.create', 'Create users', 'Create team accounts'),
('users.update', 'Update users', 'Update user/profile data'),
('users.delete', 'Delete users', 'Deactivate or delete users'),
('tasks.read', 'View tasks', 'View task board and task details'),
('tasks.create', 'Create tasks', 'Create engineering tasks'),
('tasks.update', 'Update tasks', 'Update task information'),
('tasks.delete', 'Delete tasks', 'Delete tasks'),
('tasks.assign', 'Assign tasks', 'Assign tasks to team members'),
('resources.read', 'View resources', 'View accessible resources'),
('resources.create', 'Create resources', 'Upload resources'),
('resources.update_own', 'Update own resources', 'Edit own resources'),
('resources.update_any', 'Update any resource', 'Edit any resource'),
('resources.visibility', 'Manage resource visibility', 'Toggle public/private visibility'),
('chat.read', 'Read chat', 'Read team conversations'),
('chat.send', 'Send chat messages', 'Send messages'),
('discussion.read', 'Read discussions', 'Read discussion threads'),
('discussion.create', 'Create discussions', 'Create discussion threads'),
('admin.manage', 'Manage administration', 'Access administrative controls');

INSERT INTO task_statuses (code, name, position, is_default) VALUES
('TODO', 'Undone', 1, TRUE),
('IN_PROGRESS', 'In Progress', 2, TRUE),
('COMPLETED', 'Completed', 3, TRUE);

-- ADMIN permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN';

-- MEMBER permissions based on the current product permission matrix.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
    'users.read',
    'tasks.read',
    'tasks.update',
    'tasks.assign',
    'resources.read',
    'resources.create',
    'resources.update_own',
    'chat.read',
    'chat.send',
    'discussion.read',
    'discussion.create'
)
WHERE r.code = 'MEMBER';

-- =============================================================
-- END OF SCHEMA
-- =============================================================
