-- DevTeam-Hub Merged Database Schema v1.0
-- Target: MySQL 8.0+
-- Scope: Auth (Admin/Developer), Tasks/Kanban, Task Comments, Resources & Tags,
--        Activity Stream, Team Chat/Messaging, and GitHub Integration.

CREATE DATABASE IF NOT EXISTS devteam_hub
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;

USE devteam_hub;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS github_pull_requests;
DROP TABLE IF EXISTS github_commits;
DROP TABLE IF EXISTS github_repositories;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS resource_tags;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS task_comments;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 1. USERS TABLE
-- Accounts for team members (Admin & Developer).
-- Unauthenticated Guests (Viewers) do NOT have accounts.
-- =============================================================
CREATE TABLE users (
id INT AUTO_INCREMENT PRIMARY KEY,
github_id VARCHAR(255) NOT NULL UNIQUE,
username VARCHAR(100) NOT NULL UNIQUE,
email VARCHAR(255) NOT NULL UNIQUE,
password_hash VARCHAR(255) NOT NULL,
avatar_url TEXT NULL,
bio TEXT NULL,
skills TEXT NULL,
role ENUM('Admin', 'Developer') NOT NULL DEFAULT 'Developer',
account_status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =============================================================
-- 2. TASKS / KANBAN TABLE
-- Core task tracking for Kanban Board (Undone, In Progress, Completed).
-- =============================================================
CREATE TABLE tasks (
id INT AUTO_INCREMENT PRIMARY KEY,
title VARCHAR(255) NOT NULL,
description TEXT NULL,
status ENUM('Undone', 'In Progress', 'Completed') NOT NULL DEFAULT 'Undone',
priority ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Medium',
due_date DATE NULL,
github_pr_link VARCHAR(255) NULL,
assigned_to INT NULL,
created_by INT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_tasks_assigned_to
FOREIGN KEY (assigned_to) REFERENCES users(id)
ON DELETE SET NULL ON UPDATE CASCADE,
CONSTRAINT fk_tasks_created_by
FOREIGN KEY (created_by) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 3. TASK COMMENTS TABLE
-- Discussions inside the Task Details modal on the Kanban Board.
-- =============================================================
CREATE TABLE task_comments (
id INT AUTO_INCREMENT PRIMARY KEY,
task_id INT NOT NULL,
user_id INT NOT NULL,
comment TEXT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_task_comments_task
FOREIGN KEY (task_id) REFERENCES tasks(id)
ON DELETE CASCADE ON UPDATE CASCADE,
CONSTRAINT fk_task_comments_user
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 4. RESOURCES TABLE
-- Storage for docs, Figma links, API specs (Public vs Private).
-- Public items are accessible by unauthenticated guests on Landing Page.
-- =============================================================
CREATE TABLE resources (
id INT AUTO_INCREMENT PRIMARY KEY,
title VARCHAR(255) NOT NULL,
url TEXT NOT NULL,
description TEXT NULL,
visibility ENUM('Public', 'Private') NOT NULL DEFAULT 'Private',
created_by INT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT fk_resources_created_by
FOREIGN KEY (created_by) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 5. RESOURCE TAGS TABLE
-- Tags (#API, #Docs, #UI) for filtering in the Resource Library.
-- =============================================================
CREATE TABLE resource_tags (
id INT AUTO_INCREMENT PRIMARY KEY,
resource_id INT NOT NULL,
tag_name VARCHAR(50) NOT NULL,
CONSTRAINT fk_resource_tags_resource
FOREIGN KEY (resource_id) REFERENCES resources(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 6. ACTIVITY LOGS TABLE
-- Dashboard Live Activity Stream ("Sara moved task to In Progress").
-- =============================================================
CREATE TABLE activity_logs (
id INT AUTO_INCREMENT PRIMARY KEY,
user_id INT NOT NULL,
action VARCHAR(255) NOT NULL,
details TEXT NULL,
timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_activity_logs_user
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 7. CHAT & MESSAGING TABLES
-- Channels (#general, #development) and team messages.
-- =============================================================
CREATE TABLE conversations (
id INT AUTO_INCREMENT PRIMARY KEY,
channel_name VARCHAR(100) NOT NULL,
description VARCHAR(255) NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE messages (
id INT AUTO_INCREMENT PRIMARY KEY,
conversation_id INT NOT NULL,
sender_id INT NOT NULL,
content TEXT NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_messages_conversation
FOREIGN KEY (conversation_id) REFERENCES conversations(id)
ON DELETE CASCADE ON UPDATE CASCADE,
CONSTRAINT fk_messages_sender
FOREIGN KEY (sender_id) REFERENCES users(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =============================================================
-- 8. GITHUB INTEGRATION TABLES
-- Repositories, commits, and pull requests sync metadata.
-- =============================================================
CREATE TABLE github_repositories (
id INT AUTO_INCREMENT PRIMARY KEY,
repo_name VARCHAR(255) NOT NULL,
repo_url VARCHAR(500) NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE github_commits (
id INT AUTO_INCREMENT PRIMARY KEY,
repo_id INT NOT NULL,
commit_sha VARCHAR(40) NOT NULL,
commit_message TEXT NOT NULL,
author_github_username VARCHAR(100) NULL,
committed_at TIMESTAMP NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_github_commits_repo
FOREIGN KEY (repo_id) REFERENCES github_repositories(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE github_pull_requests (
id INT AUTO_INCREMENT PRIMARY KEY,
repo_id INT NOT NULL,
pr_number INT NOT NULL,
title VARCHAR(255) NOT NULL,
state ENUM('OPEN', 'CLOSED', 'MERGED') NOT NULL DEFAULT 'OPEN',
html_url VARCHAR(500) NOT NULL,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_github_prs_repo
FOREIGN KEY (repo_id) REFERENCES github_repositories(id)
ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;