# DevTeam-Hub — Master Database Schema

> **Database:** MySQL 8.0+
> **Storage Engine:** InnoDB
> **Character Set:** utf8mb4
> **Architecture:** Relational, normalized, modular
> **Schema Version:** 1.0
> **Current Scope:** Authentication, RBAC, Teams, Tasks/Kanban, Resources, Chat, Discussions, Notifications, Activities, GitHub metadata
> **Future Scope:** GitHub Webhooks

---

## 1. Overview

The DevTeam-Hub database is the central relational data layer for the DevTeam-Hub engineering collaboration platform.

The database is designed around the application's current product requirements:

* Admin-managed user accounts
* Authentication and sessions
* Role-based access control
* Engineering teams
* Task management and Kanban workflow
* Task assignments
* Task comments and history
* Resource Library
* Public/private resource visibility
* Real-time team chat
* Discussions
* Notifications
* Activity feeds
* Administrative audit logs
* GitHub repositories
* GitHub commits
* GitHub pull requests
* Linking GitHub commits and PRs to tasks

The schema intentionally separates these domains instead of placing unrelated data into large tables.

The goal is to provide a database foundation that can support the current UI while remaining extensible for future backend functionality.

---

# 2. Design Principles

The schema follows several core database engineering principles.

### 2.1 Separation of concerns

Different application domains have separate tables.

For example:

```text
Authentication
    ↓
users
user_sessions
password_reset_tokens
email_verification_tokens

Authorization
    ↓
roles
permissions
role_permissions
user_roles

Task Management
    ↓
tasks
task_assignments
task_comments
task_history
task_dependencies
labels
task_labels

Communication
    ↓
conversations
conversation_members
messages
message_reads
discussions
discussion_comments
```

This prevents the database from becoming a single highly-coupled structure.

---

### 2.2 Normalization

Many-to-many relationships are normalized through junction tables.

Examples:

```text
users ←→ roles
        ↓
   user_roles

roles ←→ permissions
        ↓
 role_permissions

tasks ←→ labels
        ↓
 task_labels

tasks ←→ commits
        ↓
 task_commits

tasks ←→ pull requests
        ↓
 task_pull_requests
```

This reduces duplicated data and makes future changes easier.

---

### 2.3 Referential integrity

Foreign keys are used to maintain valid relationships between records.

For example:

```text
task_assignments.task_id
        ↓
tasks.id
```

A task assignment cannot reference a task that does not exist.

The schema also uses deliberate `ON DELETE` behavior depending on the relationship.

---

### 2.4 Extensibility

The schema is designed so that new functionality can be added without redesigning the entire database.

For example, GitHub metadata exists now:

```text
github_repositories
github_commits
github_pull_requests
```

but the actual webhook processing infrastructure is intentionally excluded.

This allows GitHub webhook processing to be added later without mixing future infrastructure into the current database foundation.

---

# 3. High-Level Architecture

```text
                         ┌──────────────────┐
                         │      USERS       │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
               AUTH/RBAC       TEAMS        PROJECTS
                    │             │             │
                    │             │             │
                    └─────────────┼─────────────┘
                                  │
                                  ▼
                            TASK MANAGEMENT
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
          COMMENTS             LABELS              HISTORY
             │                                         │
             └────────────────────┬────────────────────┘
                                  │
                                  ▼
                           GITHUB METADATA
                                  │
                     ┌────────────┼────────────┐
                     ▼            ▼            ▼
                REPOSITORIES   COMMITS      PULL REQUESTS


        ┌─────────────────────────────────────────────────┐
        │                 COMMUNICATION                    │
        │                                                   │
        │  Conversations → Members → Messages → Reads      │
        │                                                   │
        │  Discussions → Comments                           │
        └─────────────────────────────────────────────────┘


        ┌─────────────────────────────────────────────────┐
        │              SYSTEM ACTIVITY                     │
        │                                                   │
        │ Notifications → Activities → Audit Logs           │
        └─────────────────────────────────────────────────┘


        ┌─────────────────────────────────────────────────┐
        │               RESOURCE LIBRARY                   │
        │                                                   │
        │ Resources → Tags → Resource Tag Mapping           │
        └─────────────────────────────────────────────────┘
```

---

# 4. Database Domains

The schema is divided into the following major domains:

| Domain             | Main Tables                                                           |
| ------------------ | --------------------------------------------------------------------- |
| Identity           | `users`                                                               |
| Authentication     | `user_sessions`, `password_reset_tokens`, `email_verification_tokens` |
| Authorization      | `roles`, `permissions`, `role_permissions`, `user_roles`              |
| Teams              | `teams`, `team_members`                                               |
| Projects           | `projects`, `project_members`                                         |
| Resources          | `resources`, `resource_tags`, `resource_tag_map`                      |
| Tasks              | `tasks`, `task_statuses`, `task_assignments`                          |
| Task Collaboration | `task_comments`, `task_history`, `task_dependencies`                  |
| Labels             | `labels`, `task_labels`                                               |
| Chat               | `conversations`, `conversation_members`, `messages`, `message_reads`  |
| Discussions        | `discussions`, `discussion_comments`                                  |
| Notifications      | `notifications`                                                       |
| Activity           | `activities`                                                          |
| Security/Audit     | `audit_logs`                                                          |
| GitHub             | `github_repositories`, `github_commits`, `github_pull_requests`       |
| GitHub ↔ Tasks     | `task_commits`, `task_pull_requests`                                  |

---

# 5. Users

## Table: `users`

The `users` table represents authenticated DevTeam-Hub accounts.

A guest is **not** stored in this table.

Guest access is treated as an unauthenticated application state.

### Important fields

```text
id
username
email
password_hash
first_name
last_name
avatar_url
bio
job_title
github_username
account_status
email_verified_at
last_login_at
last_seen_at
created_at
updated_at
deleted_at
```

### Account status

Users can have:

```text
ACTIVE
INACTIVE
SUSPENDED
```

### Security

Passwords are never stored as plain text.

Only a password hash is stored:

```text
password_hash
```

The backend is responsible for hashing passwords using a secure password hashing algorithm such as Argon2id or bcrypt.

---

# 6. Authentication

Authentication is separated from the main user record.

## `user_sessions`

Stores active authentication sessions.

Conceptually:

```text
User
  │
  ├── Session
  ├── Session
  └── Session
```

This allows the same user to have multiple authenticated devices or sessions.

Session tokens should be stored securely, preferably as hashes rather than reusable raw secrets.

---

## `password_reset_tokens`

Used for password recovery.

Typical flow:

```text
User requests reset
        ↓
Backend generates token
        ↓
Token hash stored
        ↓
Reset link sent
        ↓
User submits new password
        ↓
Password updated
        ↓
Token invalidated
```

---

## `email_verification_tokens`

Supports email verification.

The database stores the verification token information separately from the user record.

---

# 7. Role-Based Access Control

DevTeam-Hub uses RBAC.

The main authenticated roles are:

```text
ADMIN
MEMBER
```

The product also has:

```text
GUEST
```

but GUEST is not stored as a database role because guests are unauthenticated.

---

## RBAC Architecture

```text
USER
  │
  ▼
USER_ROLES
  │
  ▼
ROLES
  │
  ▼
ROLE_PERMISSIONS
  │
  ▼
PERMISSIONS
```

### Tables

```text
roles
permissions
user_roles
role_permissions
```

---

## Why permissions are separate from roles

Instead of hardcoding:

```javascript
if (user.role === "ADMIN")
```

everywhere in the backend, the application can use permission-based authorization.

For example:

```text
tasks.read
tasks.create
tasks.update
tasks.delete
tasks.assign
```

This makes the authorization system extensible.

---

# 8. Permission Matrix

The initial permission model contains permissions for:

### Users

```text
users.read
users.create
users.update
users.delete
```

### Tasks

```text
tasks.read
tasks.create
tasks.update
tasks.delete
tasks.assign
```

### Resources

```text
resources.read
resources.create
resources.update_own
resources.update_any
resources.visibility
```

### Communication

```text
chat.read
chat.send
discussion.read
discussion.create
```

### Administration

```text
admin.manage
```

The initial database seed grants ADMIN all permissions and gives MEMBER the permissions appropriate to the current product requirements.

---

# 9. Teams

## `teams`

Represents engineering teams.

Example:

```text
Frontend Team
Backend Team
Mobile Team
DevOps Team
```

---

## `team_members`

Many-to-many relationship between users and teams.

```text
users
  │
  │
  ▼
team_members
  ▲
  │
  │
teams
```

This allows one user to belong to multiple teams if the product requires it.

---

# 10. Projects

## `projects`

Projects provide an optional higher-level grouping for engineering work.

A project can contain:

```text
Tasks
Resources
Team members
GitHub-related work
```

---

## `project_members`

Connects users to projects.

```text
projects
    │
    ▼
project_members
    ▲
    │
  users
```

Projects are intentionally separated from teams because a team represents organizational membership while a project represents a unit of work.

---

# 11. Resource Library

The Resource Library is represented by:

```text
resources
resource_tags
resource_tag_map
```

---

## `resources`

Stores resource metadata.

Examples:

```text
Documentation
PDF
Design file
Tutorial
Engineering document
Reference material
Link
```

The database does **not** need to store large binary files directly.

Instead, it can store:

```text
storage_key
url
mime_type
size_bytes
checksum
```

The actual file can live in:

```text
Local storage
S3-compatible storage
Cloud storage
Object storage
```

---

## Resource Visibility

Resources support:

```text
PUBLIC
PRIVATE
TEAM
PROJECT
```

The current product primarily uses public/private visibility, while TEAM and PROJECT provide room for future access-control expansion.

---

# 12. Resource Tags

Tags are normalized.

```text
resource_tags
      │
      ▼
resource_tag_map
      ▲
      │
resources
```

This creates a many-to-many relationship.

Example:

```text
Resource:
React Native Authentication

Tags:
React Native
Authentication
JWT
Mobile
```

A resource can have multiple tags and a tag can belong to multiple resources.

---

# 13. Task Management

Task management is one of the central parts of DevTeam-Hub.

Main tables:

```text
tasks
task_statuses
task_assignments
task_comments
task_dependencies
task_history
```

---

# 14. Tasks

## `tasks`

Represents engineering work items.

Typical fields include:

```text
title
description
priority
status
creator
team
project
position
due_date
started_at
completed_at
created_at
updated_at
```

---

# 15. Kanban Status

Instead of hardcoding task status as an ENUM, the schema uses:

```text
task_statuses
```

Initial statuses:

```text
TODO
IN_PROGRESS
COMPLETED
```

Displayed in the UI as:

```text
Undone
In Progress
Completed
```

This makes the Kanban workflow configurable in the future.

---

# 16. Drag-and-Drop Ordering

Tasks contain a:

```text
position
```

field.

The position uses a decimal value so that tasks can be reordered without rewriting the position of every task.

Example:

```text
Task A = 1000
Task B = 2000
Task C = 3000
```

If a task is moved between A and B:

```text
Task A = 1000
Task X = 1500
Task B = 2000
```

This is more efficient than constantly renumbering every task.

---

# 17. Task Assignments

## `task_assignments`

Tasks and users have a many-to-many relationship.

```text
tasks
  │
  ▼
task_assignments
  ▲
  │
users
```

A task can have:

```text
PRIMARY
CONTRIBUTOR
```

assignments.

This supports collaborative engineering tasks.

---

# 18. Task Comments

## `task_comments`

Stores discussion directly related to a task.

Example:

```text
Task:
Implement JWT authentication

Comment:
"Login endpoint is complete. Refresh token handling remains."
```

Task comments are separate from general chat because task discussion belongs to the task domain.

---

# 19. Task History

## `task_history`

Stores changes to tasks.

Examples:

```text
Status changed
Priority changed
Assignee changed
Title changed
Due date changed
Description changed
```

This provides an audit-style timeline for task changes.

Example:

```text
Task created
      ↓
Assigned to Mark
      ↓
Status → In Progress
      ↓
Priority → High
      ↓
Status → Completed
```

---

# 20. Task Dependencies

## `task_dependencies`

Allows relationships such as:

```text
Task A blocks Task B
Task B depends on Task A
```

This provides a foundation for more advanced project management.

---

# 21. Labels

Tasks can use labels.

Tables:

```text
labels
task_labels
```

Example:

```text
BUG
FEATURE
URGENT
BACKEND
FRONTEND
DATABASE
```

Many-to-many mapping:

```text
Task
 ├── BUG
 ├── BACKEND
 └── URGENT
```

---

# 22. Real-Time Chat

Chat is separated into four primary tables:

```text
conversations
conversation_members
messages
message_reads
```

---

## Conversations

A conversation represents a chat channel or direct conversation.

---

## Conversation Members

Connects users to conversations.

```text
users
   │
   ▼
conversation_members
   ▲
   │
conversations
```

---

## Messages

Stores persistent chat messages.

Example:

```text
conversation_id
sender_id
content
created_at
```

---

## Message Reads

Tracks read state.

This supports features such as:

```text
Read receipts
Unread message counts
Last read message
```

---

# 23. Real-Time Presence

The application uses Socket.io for real-time communication.

Not every real-time event should be stored in MySQL.

For example:

```text
typing...
online
offline
user is composing
```

These are transient states and should normally be managed by the realtime layer.

The database only persists useful long-term information such as:

```text
users.last_seen_at
```

This separation keeps the database from being overloaded with high-frequency transient events.

---

# 24. Discussions

Discussions are separate from chat.

Tables:

```text
discussions
discussion_comments
```

Chat is designed for real-time communication.

Discussions are designed for persistent topic-based conversations.

Example:

```text
Discussion:
"Should we migrate the backend to microservices?"

Comments:
    User A
    User B
    User C
```

---

# 25. Notifications

## `notifications`

Stores user-specific notifications.

Examples:

```text
Task assigned
Task completed
New message
Mention
Discussion comment
GitHub activity
```

Notifications contain a generic entity reference:

```text
entity_type
entity_id
```

This allows a notification to point to different application objects.

For example:

```text
entity_type = TASK
entity_id   = <task-id>
```

or:

```text
entity_type = DISCUSSION
entity_id   = <discussion-id>
```

---

# 26. Activity Feed

## `activities`

Stores application-level activities.

Examples:

```text
Mark created a task
Sara completed a task
John uploaded a resource
Admin created a user
A pull request was linked to a task
```

The activity feed is separate from notifications.

### Difference

**Notification**

```text
Personal action requiring user attention
```

**Activity**

```text
Historical event visible in the activity stream
```

---

# 27. Audit Logs

## `audit_logs`

Audit logs are designed for administrative and security-sensitive events.

Examples:

```text
User created
User suspended
Role changed
Permission changed
Resource visibility changed
Administrative action performed
```

This should not be confused with normal activity events.

```text
activities
    ↓
Product activity

audit_logs
    ↓
Security / administration / compliance
```

---

# 28. GitHub Integration

The current product already references GitHub-related information.

The database therefore contains:

```text
github_repositories
github_commits
github_pull_requests
```

---

# 29. GitHub Repositories

## `github_repositories`

Stores repository metadata.

Examples:

```text
repository name
owner
GitHub repository ID
URL
default branch
visibility
```

This is application metadata, not a local Git repository.

---

# 30. GitHub Commits

## `github_commits`

Stores commit metadata.

Examples:

```text
SHA
message
author
committer
commit URL
committed time
repository
```

---

# 31. GitHub Pull Requests

## `github_pull_requests`

Stores pull request metadata.

Examples:

```text
PR number
title
body
state
author
URL
source branch
target branch
merged status
```

---

# 32. Tasks ↔ GitHub

The database supports linking engineering work to GitHub activity.

### Task → Commit

```text
tasks
  │
  ▼
task_commits
  ▲
  │
github_commits
```

### Task → Pull Request

```text
tasks
  │
  ▼
task_pull_requests
  ▲
  │
github_pull_requests
```

This allows a task to show related GitHub work.

Example:

```text
Task #42
"Implement authentication"

    ↓

Commit:
feat(auth): implement JWT login

    ↓

Pull Request:
#87 Add JWT authentication
```

---

# 33. GitHub Webhooks — Future Scope

GitHub Webhooks are **not implemented in this database version**.

The current schema only stores GitHub metadata required by the existing application.

Future webhook infrastructure may introduce tables such as:

```text
webhook_events
webhook_deliveries
webhook_attempts
webhook_failures
```

However, these tables should only be introduced when the actual webhook architecture is implemented.

The future architecture can be:

```text
GitHub
   │
   │ Webhook
   ▼
API Endpoint
   │
   ▼
Webhook Validation
   │
   ▼
Queue / Worker
   │
   ▼
Database
   │
   ├── github_commits
   ├── github_pull_requests
   └── activities
```

This keeps the current schema clean and avoids implementing infrastructure before it is required.

---

# 34. UUID Strategy

Most application entities use:

```text
CHAR(36)
```

UUID-style identifiers.

Examples:

```text
users.id
teams.id
tasks.id
resources.id
messages.id
discussions.id
```

This provides globally unique identifiers and avoids exposing sequential database IDs for major application entities.

Small lookup/system tables such as roles and permissions use numeric IDs because their records are controlled system data.

---

# 35. Timestamps

The schema consistently uses:

```text
created_at
updated_at
```

where appropriate.

Some domains also include specialized timestamps:

```text
last_login_at
last_seen_at
email_verified_at
started_at
completed_at
due_at
read_at
merged_at
```

This allows the application to reconstruct important lifecycle events.

---

# 36. Soft Deletion

Some major entities support:

```text
deleted_at
```

instead of immediately deleting records.

This is important when historical information must remain available.

For example:

```text
User
Task
Resource
```

can potentially be soft-deleted while maintaining historical references.

---

# 37. Database Security

The schema follows several security principles.

### Passwords

Never store:

```text
password
```

Store:

```text
password_hash
```

---

### Authentication tokens

Long-lived reset/session secrets should preferably be stored as hashes.

---

### Authorization

Authorization is handled through:

```text
roles
permissions
role_permissions
user_roles
```

rather than relying only on frontend UI restrictions.

---

### Auditability

Administrative actions can be recorded through:

```text
audit_logs
```

---

# 38. Important Backend Rule

The frontend must never be treated as the security boundary.

For example, hiding:

```text
Delete User
```

from a MEMBER user is not sufficient.

The backend must verify:

```text
Authenticated user
        ↓
Role
        ↓
Permission
        ↓
Resource ownership/access
        ↓
Database operation
```

The database schema provides the foundation, while the backend enforces the actual authorization rules.

---

# 39. Foreign Key Philosophy

Foreign keys are intentionally used throughout the schema.

For example:

```text
task_assignments.task_id
        ↓
tasks.id
```

and:

```text
task_commits.commit_id
        ↓
github_commits.id
```

Different relationships use different delete behavior.

### CASCADE

Used when the child has no meaning without the parent.

Example:

```text
task_labels
```

can be deleted when the task is permanently removed.

### SET NULL

Used when historical information should survive even if the referenced user is removed.

For example:

```text
created_by
linked_by
```

can become `NULL` while the historical record remains.

---

# 40. Indexing Strategy

Indexes are added for frequently queried fields.

Examples:

```text
users.email
users.username
users.account_status
users.last_seen_at
```

Task-related indexes support:

```text
team
project
status
priority
assignee
due date
creator
```

Communication indexes support:

```text
conversation
sender
created_at
read state
```

The purpose is to optimize common application queries without indexing every column unnecessarily.

---

# 41. Current Product Scope

The current database officially supports:

```text
✓ Authentication
✓ Admin-created accounts
✓ RBAC
✓ Teams
✓ Projects
✓ Resource Library
✓ Public/private resources
✓ Resource tags
✓ Task management
✓ Kanban workflow
✓ Task assignments
✓ Task comments
✓ Task history
✓ Task dependencies
✓ Labels
✓ Real-time chat persistence
✓ Read receipts
✓ Discussions
✓ Notifications
✓ Activity feed
✓ Audit logs
✓ GitHub repositories
✓ GitHub commits
✓ GitHub pull requests
✓ Task ↔ GitHub relationships
```

---

# 42. Explicitly Out of Current Scope

The following should not be considered implemented by this schema:

```text
✗ GitHub Webhook processing
✗ Webhook queues
✗ Webhook retry workers
✗ GitHub signature verification storage
✗ Background webhook workers
✗ Real-time presence persistence for every socket event
✗ Binary file storage inside MySQL
```

These belong to future backend infrastructure.

---

# 43. Suggested Backend Architecture

The database should sit behind the backend API.

Recommended logical architecture:

```text
                 CLIENT
                   │
                   ▼
              REST / API
                   │
                   ▼
          ┌─────────────────┐
          │   AUTH MIDDLEWARE│
          └────────┬────────┘
                   │
                   ▼
          ┌─────────────────┐
          │  RBAC / SERVICE │
          │     LAYER       │
          └────────┬────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
      MySQL DB          Socket.io
          │                 │
          │                 ├── Chat
          │                 ├── Presence
          │                 └── Typing
          │
          ▼
     GitHub Service
          │
          ▼
   GitHub API / Future Webhooks
```

The database should not be accessed directly by the frontend.

---

# 44. Recommended Application Layers

A professional backend implementation should separate:

```text
Routes
   ↓
Controllers
   ↓
Services
   ↓
Repositories / ORM
   ↓
MySQL
```

For example:

```text
POST /tasks
      ↓
TaskController
      ↓
TaskService
      ↓
TaskRepository
      ↓
MySQL
```

Authorization should happen before sensitive service operations.

---

# 45. Database Initialization

The master schema creates:

```text
devteam_hub
```

with:

```text
utf8mb4
utf8mb4_0900_ai_ci
```

and uses:

```text
InnoDB
```

for transactional integrity and foreign-key support.

---

# 46. Seed Data

The schema includes initial system data for:

### Roles

```text
ADMIN
MEMBER
```

### Task statuses

```text
TODO
IN_PROGRESS
COMPLETED
```

### Permissions

```text
users.*
tasks.*
resources.*
chat.*
discussion.*
admin.*
```

The seed data provides a working starting point for the backend.

---

# 47. Important Implementation Rule

The SQL schema should be treated as the **database architecture baseline**, not as permission to blindly overwrite an existing backend.

Before implementation, the backend should be inspected for:

```text
Existing models
Existing migrations
Existing authentication
Existing API routes
Existing ORM
Existing environment configuration
Existing database connection
```

Then the schema should be implemented through the project's chosen migration/ORM system.

---

# 48. Development Workflow

Recommended development sequence:

```text
1. Database
      ↓
2. Database connection
      ↓
3. ORM / migrations
      ↓
4. Seed data
      ↓
5. Authentication
      ↓
6. RBAC
      ↓
7. Users / Teams
      ↓
8. Tasks / Kanban
      ↓
9. Resources
      ↓
10. Chat
      ↓
11. Notifications / Activities
      ↓
12. GitHub metadata
      ↓
13. Future Webhooks
```

This keeps implementation incremental and testable.

---

# 49. Schema Philosophy

The most important principle behind this schema is:

> **Build the stable data foundation first; add real-time and external integrations as separate application capabilities.**

MySQL should be responsible for durable application state.

Socket.io should handle transient realtime state.

GitHub should remain an external system.

Future webhook workers should synchronize external events into the database.

This separation prevents the database from becoming tightly coupled to external services.

---

# 50. Final Architecture Summary

DevTeam-Hub's database can be understood as seven major systems:

```text
┌─────────────────────────────────────┐
│             IDENTITY                │
│ Users + Authentication + RBAC       │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│          ORGANIZATION               │
│ Teams + Projects                    │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│        ENGINEERING WORK             │
│ Tasks + Kanban + Labels + History   │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│         COLLABORATION               │
│ Chat + Discussions + Comments       │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│           KNOWLEDGE                 │
│ Resources + Tags                    │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│          INTEGRATIONS               │
│ GitHub Repositories + Commits + PRs │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│       OBSERVABILITY / AUDIT         │
│ Notifications + Activities + Logs  │
└─────────────────────────────────────┘
```

The result is a modular MySQL foundation that matches the current DevTeam-Hub product direction while leaving clear boundaries for future features such as GitHub Webhooks.
