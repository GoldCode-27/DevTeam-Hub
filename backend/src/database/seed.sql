USE devteam_hub;

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM activity_log;
DELETE FROM user_permissions;
DELETE FROM permissions;
DELETE FROM subtasks;
DELETE FROM task_comments;
DELETE FROM task_tags;
DELETE FROM task_github_events;
DELETE FROM tasks;
DELETE FROM tags;
DELETE FROM user_skills;
DELETE FROM sessions;
DELETE FROM users;

ALTER TABLE activity_log AUTO_INCREMENT = 1;
ALTER TABLE permissions AUTO_INCREMENT = 1;
ALTER TABLE tasks AUTO_INCREMENT = 1;
ALTER TABLE tags AUTO_INCREMENT = 1;
ALTER TABLE users AUTO_INCREMENT = 1;

-- 1. PERMISSIONS
INSERT INTO permissions (id, slug, module, description) VALUES
(1, 'user:manage', 'USERS', 'Manage user accounts, roles and system administration'),
(2, 'task:create', 'TASKS', 'Create new engineering tasks'),
(3, 'task:update', 'TASKS', 'Update task details and movements'),
(4, 'task:delete', 'TASKS', 'Delete tasks from board'),
(5, 'resource:create', 'RESOURCES', 'Upload and create technical assets');

-- 2. USERS (With job_title, current_focus, social_links)
INSERT INTO users (id, public_id, username, email, password_hash, first_name, last_name, job_title, current_focus, status, bio, last_active_at) VALUES
(1, '3f1c9a52-6b7e-4c1d-9a0e-2f4d8b7a1c11', 'alex.chen', 'alex.chen@company.com', '$2a$12$e80y...', 'Alex', 'Chen', 'Fullstack Developer', 'UI components', 'ACTIVE', 'Always shipping.', NOW()),
(2, '9c3d2e1f-7a6b-4c5d-8e9f-0a1b2c3d4e5f', 'sara.kim', 'sara.kim@company.com', '$2a$12$e80y...', 'Sara', 'Kim', 'Backend Developer', 'API integration & database', 'ACTIVE', 'Passionate about distributed systems', NOW() - INTERVAL 5 MINUTE),
(3, 'b6a7c0de-1d2e-4f3a-8b9c-0a1b2c3d4e5f', 'john.doe', 'john.doe@company.com', '$2a$12$e80y...', 'John', 'Doe', 'DevOps Specialist', 'CI/CD pipeline', 'ACTIVE', 'Cloud architecture', NOW() - INTERVAL 80 HOUR);

-- 3. USER PERMISSIONS
INSERT INTO user_permissions (user_id, permission_id) VALUES
(1, 1),
(1, 2),
(1, 3),
(2, 2),
(2, 3);

-- 4. TAGS
INSERT INTO tags (id, name, color_hex) VALUES
(1, 'Backend', '#6366F1'),
(2, 'API', '#0D9488'),
(3, 'UI', '#EC4899');

-- 5. TASKS (With is_public flag)
INSERT INTO tasks (id, task_code, title, description, status, priority, is_public, position, due_date, assignee_id, created_by) VALUES
(1, 'DEV-101', 'Implement authentication API', 'Setup JWT token verification and login routes', 'IN_PROGRESS', 'HIGH', 1, 1000.0000, CURDATE() + INTERVAL 2 DAY, 1, 1),
(2, 'DEV-102', 'Setup MySQL connection pool', 'Configure resilient pool connections for XAMPP', 'COMPLETED', 'HIGH', 0, 2000.0000, CURDATE() - INTERVAL 1 DAY, 1, 1),
(3, 'DEV-103', 'Design Live Pulse component', 'Build active user presence glowing badge', 'UNDONE', 'MEDIUM', 1, 3000.0000, CURDATE() + INTERVAL 4 DAY, 1, 1),
(4, 'DEV-104', 'Database schema indexing', 'Add indexes to tasks and activity streams', 'UNDONE', 'URGENT', 0, 4000.0000, CURDATE() + INTERVAL 1 DAY, 2, 1);

-- 6. ACTIVITY LOG (Matching exact ENUM types)
INSERT INTO activity_log (id, type, actor_id, entity_type, entity_ref, summary, created_at) VALUES
(1, 'TASK_UPDATED', 1, 'TASK', 'DEV-101', 'moved task Implement authentication API to In Progress', NOW() - INTERVAL 2 HOUR),
(2, 'TASK_UPDATED', 1, 'TASK', 'DEV-102', 'completed task Setup MySQL connection pool', NOW() - INTERVAL 1 DAY),
(3, 'SYSTEM', 1, 'SYSTEM', 'BOOTSTRAP', 'system foundation initialized successfully', NOW() - INTERVAL 4 DAY);

SET FOREIGN_KEY_CHECKS = 1;