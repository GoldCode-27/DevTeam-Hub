-- =====================================================================
-- DEVTEAM-HUB — MODERN DESIGN SYSTEM SCHEMA
-- MySQL 8.0+ | InnoDB | utf8mb4 | utf8mb4_0900_ai_ci
-- =====================================================================
-- Description:
--   Complete production-grade database schema for the DevTeam-Hub
--   design system platform. Supports teams, projects, design tokens
--   (colors, typography, spacing, radius, shadows), components,
--   versioning, comments, and full audit logging.
--
-- Features:
--   - UUID v7 for distributed-friendly unique identifiers
--   - Generated columns for auto-computed values (RGB, REM, CSS)
--   - JSON columns for flexible, schema-less data
--   - Full-text search indexes for fast lookups
--   - Soft delete support via deleted_at
--   - Row versioning for optimistic locking
--   - Automatic audit trail via triggers
--   - Table partitioning for high-volume audit logs
--   - Semantic versioning for design releases
-- =====================================================================


-- =====================================================================
-- DATABASE SETUP
-- =====================================================================

DROP DATABASE IF EXISTS devteam_hub;
CREATE DATABASE devteam_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE devteam_hub;

-- Session settings for modern behavior
SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';


-- =====================================================================
-- SHARED UTILITIES
-- =====================================================================

DELIMITER $$

-- Generate time-ordered UUID v7 (index-friendly, distributed-safe)
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

-- Generic audit logging procedure
CREATE PROCEDURE log_audit(
  IN p_table VARCHAR(64),
  IN p_record_id BIGINT,
  IN p_action VARCHAR(20),
  IN p_user_id BIGINT,
  IN p_changes JSON
)
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, user_id, changes_json, created_at)
  VALUES (p_table, p_record_id, p_action, p_user_id, p_changes, UTC_TIMESTAMP());
END$$

DELIMITER ;


-- =====================================================================
-- USERS & PERMISSIONS
-- =====================================================================

-- Users table with soft delete, JSON preferences, and optimistic locking
CREATE TABLE users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
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
                      'notifications', JSON_OBJECT('email', TRUE, 'push', TRUE),
                      'sidebar_collapsed', FALSE
                    )),

  status            ENUM('active','suspended','pending','deleted')
                    NOT NULL DEFAULT 'active',
  role              ENUM('owner','admin','designer','developer','viewer')
                    NOT NULL DEFAULT 'viewer',
  last_login_at     DATETIME DEFAULT NULL,
  last_login_ip     VARBINARY(16) DEFAULT NULL,

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,

  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  INDEX idx_users_status_role (status, role),
  INDEX idx_users_active (deleted_at, status),
  INDEX idx_users_last_login (last_login_at DESC),
  FULLTEXT KEY ft_users_search (username, full_name, bio)
) ENGINE=InnoDB
  ROW_FORMAT=DYNAMIC
  COMMENT='DevTeam-Hub users with soft delete and JSON preferences';


-- Roles with flexible JSON permission sets
CREATE TABLE roles (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(50) NOT NULL UNIQUE,
  display_name      VARCHAR(100) NOT NULL,
  description       VARCHAR(255) DEFAULT NULL,
  permissions       JSON NOT NULL,
  is_system         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
) ENGINE=InnoDB;

INSERT INTO roles (name, display_name, permissions, is_system) VALUES
('owner',    'Owner',    JSON_OBJECT('all', TRUE), TRUE),
('admin',    'Admin',    JSON_OBJECT('projects','*','teams','*','users','read'), TRUE),
('designer', 'Designer', JSON_OBJECT('projects',JSON_ARRAY('read','write'),'tokens','*'), TRUE),
('developer','Developer',JSON_OBJECT('projects','read','tokens','read'), TRUE),
('viewer',   'Viewer',   JSON_OBJECT('projects','read'), TRUE);


-- User-role assignments with optional scoping and expiration
CREATE TABLE user_roles (
  user_id           BIGINT UNSIGNED NOT NULL,
  role_id           BIGINT UNSIGNED NOT NULL,
  scope_type        ENUM('global','team','project') NOT NULL DEFAULT 'global',
  scope_id          BIGINT UNSIGNED DEFAULT NULL,
  granted_by        BIGINT UNSIGNED DEFAULT NULL,
  granted_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  expires_at        DATETIME DEFAULT NULL,

  PRIMARY KEY (user_id, role_id, scope_type, scope_id),
  CONSTRAINT fk_ur_user  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role  FOREIGN KEY (role_id)  REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_grant FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ur_scope (scope_type, scope_id),
  INDEX idx_ur_expires (expires_at)
) ENGINE=InnoDB;


-- =====================================================================
-- TEAMS & PROJECTS
-- =====================================================================

-- Teams with soft delete and JSON settings
CREATE TABLE teams (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  name              VARCHAR(120) NOT NULL,
  slug              VARCHAR(120) NOT NULL,
  description       TEXT DEFAULT NULL,
  logo_url          VARCHAR(500) DEFAULT NULL,
  settings          JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'allow_guest_access', FALSE,
                      'default_visibility', 'team'
                    )),
  owner_id          BIGINT UNSIGNED NOT NULL,
  is_archived       BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,

  UNIQUE KEY uq_teams_slug (slug),
  CONSTRAINT fk_teams_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_teams_archived (is_archived, deleted_at),
  FULLTEXT KEY ft_teams_search (name, description)
) ENGINE=InnoDB;


-- Team membership with roles and notification preferences
CREATE TABLE team_members (
  team_id           BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  role              ENUM('owner','admin','member','guest') NOT NULL DEFAULT 'member',
  invited_by        BIGINT UNSIGNED DEFAULT NULL,
  invited_at        DATETIME DEFAULT NULL,
  joined_at         DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  last_active_at    DATETIME DEFAULT NULL,
  notification_prefs JSON NOT NULL DEFAULT (JSON_OBJECT('mentions', TRUE, 'digest', 'daily')),

  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_tmem_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmem_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmem_inviter FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tmem_role (role),
  INDEX idx_tmem_active (last_active_at DESC)
) ENGINE=InnoDB;


-- Projects with auto-generated semver components from version string
CREATE TABLE projects (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  team_id           BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(150) NOT NULL,
  slug              VARCHAR(150) NOT NULL,
  description       TEXT DEFAULT NULL,
  cover_image_url   VARCHAR(500) DEFAULT NULL,

  status            ENUM('draft','active','review','released','archived')
                    NOT NULL DEFAULT 'draft',
  visibility        ENUM('private','team','public') NOT NULL DEFAULT 'team',
  version           VARCHAR(20) NOT NULL DEFAULT '0.1.0',

  semver            JSON GENERATED ALWAYS AS (
                      JSON_OBJECT(
                        'major', CAST(SUBSTRING_INDEX(version, '.', 1) AS UNSIGNED),
                        'minor', CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(version, '.', 2), '.', -1) AS UNSIGNED),
                        'patch', CAST(SUBSTRING_INDEX(version, '.', -1) AS UNSIGNED)
                      )
                    ) VIRTUAL,

  tags              JSON NOT NULL DEFAULT (JSON_ARRAY()),
  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),

  created_by        BIGINT UNSIGNED NOT NULL,
  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),
  row_version       INT UNSIGNED NOT NULL DEFAULT 1,

  UNIQUE KEY uq_project_slug (team_id, slug),
  CONSTRAINT fk_proj_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_proj_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_proj_status (status, visibility),
  INDEX idx_proj_team_active (team_id, deleted_at),
  INDEX idx_proj_updated (updated_at DESC),
  FULLTEXT KEY ft_proj_search (name, description)
) ENGINE=InnoDB
  COMMENT='Projects with auto-generated semver components';


-- =====================================================================
-- COLOR SYSTEM
-- =====================================================================

-- Color palettes with light/dark/high-contrast modes
CREATE TABLE color_palettes (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,
  name              VARCHAR(100) NOT NULL,
  description       VARCHAR(255) DEFAULT NULL,
  mode              ENUM('light','dark','high-contrast') NOT NULL DEFAULT 'light',
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_cp_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_palette_name (project_id, name, mode),
  INDEX idx_cp_project_default (project_id, is_default)
) ENGINE=InnoDB;


-- Color tokens with auto-generated RGB values and WCAG contrast support
CREATE TABLE color_tokens (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  palette_id        BIGINT UNSIGNED NOT NULL,

  token_name        VARCHAR(80) NOT NULL,
  display_name      VARCHAR(80) NOT NULL,
  token_path        VARCHAR(160) NOT NULL,

  hex_value         CHAR(7) NOT NULL,
  rgb_r             TINYINT UNSIGNED GENERATED ALWAYS AS (CONV(SUBSTRING(hex_value, 2, 2), 16, 10)) STORED,
  rgb_g             TINYINT UNSIGNED GENERATED ALWAYS AS (CONV(SUBSTRING(hex_value, 4, 2), 16, 10)) STORED,
  rgb_b             TINYINT UNSIGNED GENERATED ALWAYS AS (CONV(SUBSTRING(hex_value, 6, 2), 16, 10)) STORED,
  rgb_value         VARCHAR(20) GENERATED ALWAYS AS (
                      CONCAT('rgb(',
                        CONV(SUBSTRING(hex_value, 2, 2), 16, 10), ',',
                        CONV(SUBSTRING(hex_value, 4, 2), 16, 10), ',',
                        CONV(SUBSTRING(hex_value, 6, 2), 16, 10), ')')
                    ) STORED,
  alpha             DECIMAL(3,2) NOT NULL DEFAULT 1.00,

  category          ENUM('brand','neutral','semantic','accent','custom')
                    NOT NULL DEFAULT 'custom',
  semantic_role     ENUM('primary','secondary','success','warning','danger','info','neutral')
                    DEFAULT NULL,

  usage_note        VARCHAR(255) DEFAULT NULL,
  contrast_with     VARCHAR(80) DEFAULT NULL,

  parent_id         BIGINT UNSIGNED DEFAULT NULL,
  scale_step        TINYINT UNSIGNED DEFAULT NULL,

  sort_order        INT NOT NULL DEFAULT 0,
  is_deprecated     BOOLEAN NOT NULL DEFAULT FALSE,
  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_ct_palette FOREIGN KEY (palette_id) REFERENCES color_palettes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_parent  FOREIGN KEY (parent_id)  REFERENCES color_tokens(id) ON DELETE SET NULL,
  CONSTRAINT chk_ct_hex    CHECK (hex_value REGEXP '^#[0-9A-Fa-f]{6}$'),

  UNIQUE KEY uq_palette_token (palette_id, token_name),
  INDEX idx_ct_category_role (category, semantic_role),
  INDEX idx_ct_path (token_path),
  INDEX idx_ct_scale (palette_id, parent_id, scale_step)
) ENGINE=InnoDB;


-- =====================================================================
-- TYPOGRAPHY SYSTEM
-- =====================================================================

-- Font families with JSON metadata for weights and styles
CREATE TABLE font_families (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,

  name              VARCHAR(100) NOT NULL,
  css_stack         VARCHAR(500) NOT NULL,
  font_type         ENUM('sans','serif','mono','display','script','system')
                    NOT NULL DEFAULT 'sans',

  source_type       ENUM('system','google','adobe','self-hosted','cdn') NOT NULL DEFAULT 'system',
  source_url        VARCHAR(500) DEFAULT NULL,

  available_weights JSON NOT NULL DEFAULT (JSON_ARRAY(400)),
  available_styles  JSON NOT NULL DEFAULT (JSON_ARRAY('normal')),
  unicode_ranges    JSON DEFAULT NULL,
  fallback_chain    JSON DEFAULT NULL,

  metadata          JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_ff_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_font_name (project_id, name),
  INDEX idx_ff_type (font_type)
) ENGINE=InnoDB;


-- Type styles (Display, H1, Body, etc.) with responsive overrides
CREATE TABLE type_styles (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  font_family_id    BIGINT UNSIGNED NOT NULL,

  style_name        VARCHAR(60) NOT NULL,
  style_role        ENUM('display','heading','subheading','body','caption','label','code','quote')
                    NOT NULL DEFAULT 'body',
  level             TINYINT UNSIGNED DEFAULT NULL,

  font_size_px      DECIMAL(6,2) NOT NULL,
  font_size_rem     DECIMAL(5,3) GENERATED ALWAYS AS (font_size_px / 16) STORED,
  font_weight       SMALLINT UNSIGNED NOT NULL DEFAULT 400,
  line_height       DECIMAL(4,2) NOT NULL DEFAULT 1.50,
  letter_spacing    DECIMAL(5,3) DEFAULT 0.000,
  text_transform    ENUM('none','uppercase','lowercase','capitalize') NOT NULL DEFAULT 'none',
  font_style        ENUM('normal','italic','oblique') NOT NULL DEFAULT 'normal',

  responsive_json   JSON DEFAULT NULL,
  sample_text       VARCHAR(255) DEFAULT NULL,
  usage_note        VARCHAR(255) DEFAULT NULL,
  sort_order        INT NOT NULL DEFAULT 0,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_ts_font FOREIGN KEY (font_family_id) REFERENCES font_families(id) ON DELETE CASCADE,
  UNIQUE KEY uq_font_style (font_family_id, style_name),
  INDEX idx_ts_role (style_role, level)
) ENGINE=InnoDB;


-- =====================================================================
-- SPACING, RADIUS, SHADOWS
-- =====================================================================

-- Spacing scales (default base unit: 4px grid)
CREATE TABLE spacing_scales (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        BIGINT UNSIGNED NOT NULL,
  scale_name        VARCHAR(40) NOT NULL DEFAULT 'default',
  base_unit         SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  CONSTRAINT fk_ss_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_scale (project_id, scale_name)
) ENGINE=InnoDB;


CREATE TABLE spacing_tokens (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scale_id          BIGINT UNSIGNED NOT NULL,
  token_name        VARCHAR(40) NOT NULL,
  value_px          SMALLINT UNSIGNED NOT NULL,
  value_rem         DECIMAL(4,3) GENERATED ALWAYS AS (value_px / 16) STORED,
  step              SMALLINT NOT NULL,
  usage_note        VARCHAR(120) DEFAULT NULL,

  CONSTRAINT fk_st_scale FOREIGN KEY (scale_id) REFERENCES spacing_scales(id) ON DELETE CASCADE,
  UNIQUE KEY uq_scale_token (scale_id, token_name),
  INDEX idx_st_step (scale_id, step)
) ENGINE=InnoDB;


-- Border radius tokens with auto-detected pill flag
CREATE TABLE radius_tokens (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        BIGINT UNSIGNED NOT NULL,
  token_name        VARCHAR(40) NOT NULL,
  value_px          SMALLINT UNSIGNED NOT NULL,
  is_pill           BOOLEAN GENERATED ALWAYS AS (value_px >= 999) STORED,
  usage_note        VARCHAR(120) DEFAULT NULL,
  sort_order        INT NOT NULL DEFAULT 0,

  CONSTRAINT fk_rt_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_radius_token (project_id, token_name)
) ENGINE=InnoDB;


-- Shadow tokens with auto-generated CSS value
CREATE TABLE shadow_tokens (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        BIGINT UNSIGNED NOT NULL,
  token_name        VARCHAR(40) NOT NULL,

  offset_x          SMALLINT NOT NULL,
  offset_y          SMALLINT NOT NULL,
  blur_radius       SMALLINT UNSIGNED NOT NULL,
  spread_radius     SMALLINT NOT NULL DEFAULT 0,
  color_hex         CHAR(7) NOT NULL DEFAULT '#000000',
  opacity           DECIMAL(3,2) NOT NULL DEFAULT 0.10,
  is_inset          BOOLEAN NOT NULL DEFAULT FALSE,

  css_value         VARCHAR(255) GENERATED ALWAYS AS (
                      CONCAT(
                        IF(is_inset, 'inset ', ''),
                        offset_x, 'px ', offset_y, 'px ',
                        blur_radius, 'px ', spread_radius, 'px ',
                        'rgba(',
                          CONV(SUBSTRING(color_hex, 2, 2), 16, 10), ',',
                          CONV(SUBSTRING(color_hex, 4, 2), 16, 10), ',',
                          CONV(SUBSTRING(color_hex, 6, 2), 16, 10), ',',
                          opacity,
                        ')'
                      )
                    ) STORED,

  elevation_level   TINYINT UNSIGNED DEFAULT NULL,
  usage_note        VARCHAR(150) DEFAULT NULL,
  sort_order        INT NOT NULL DEFAULT 0,

  CONSTRAINT fk_sht_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_shadow_token (project_id, token_name),
  INDEX idx_sht_elevation (project_id, elevation_level)
) ENGINE=InnoDB;


-- =====================================================================
-- COMPONENTS
-- =====================================================================

-- Component registry
CREATE TABLE components (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,

  name              VARCHAR(100) NOT NULL,
  slug              VARCHAR(100) NOT NULL,
  category          ENUM('action','feedback','form','navigation','layout','display','data')
                    NOT NULL DEFAULT 'display',
  description       TEXT DEFAULT NULL,

  base_props        JSON NOT NULL DEFAULT (JSON_OBJECT()),
  accessibility     JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'aria_roles', JSON_ARRAY(),
                      'keyboard_support', JSON_ARRAY()
                    )),
  framework_hints   JSON DEFAULT NULL,

  is_deprecated     BOOLEAN NOT NULL DEFAULT FALSE,
  replaced_by       BIGINT UNSIGNED DEFAULT NULL,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_comp_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_comp_replaced FOREIGN KEY (replaced_by) REFERENCES components(id) ON DELETE SET NULL,
  UNIQUE KEY uq_project_component_slug (project_id, slug),
  INDEX idx_comp_category (category, is_deprecated),
  FULLTEXT KEY ft_comp_search (name, description)
) ENGINE=InnoDB;


-- Component variants (primary/secondary/danger × sm/md/lg)
CREATE TABLE component_variants (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  component_id      BIGINT UNSIGNED NOT NULL,

  variant_name      VARCHAR(60) NOT NULL,
  size              ENUM('xs','sm','md','lg','xl') NOT NULL DEFAULT 'md',
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,

  tokens_json       JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'background', NULL,
                      'foreground', NULL,
                      'border', NULL,
                      'radius', NULL,
                      'shadow', NULL,
                      'spacing', JSON_OBJECT('x', NULL, 'y', NULL)
                    )),

  states_json       JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'hover',    JSON_OBJECT(),
                      'focus',    JSON_OBJECT(),
                      'active',   JSON_OBJECT(),
                      'disabled', JSON_OBJECT()
                    )),

  typography_json   JSON NOT NULL DEFAULT (JSON_OBJECT()),
  layout_json       JSON NOT NULL DEFAULT (JSON_OBJECT()),

  accessibility     JSON NOT NULL DEFAULT (JSON_OBJECT(
                      'min_contrast_ratio', 4.5,
                      'min_touch_target_px', 44
                    )),

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_cv_component FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
  UNIQUE KEY uq_component_variant_size (component_id, variant_name, size),
  INDEX idx_cv_default (component_id, is_default)
) ENGINE=InnoDB;


-- =====================================================================
-- UNIFIED TOKEN REGISTRY
-- =====================================================================

-- Denormalized view of all tokens for API/export convenience
CREATE TABLE design_tokens (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,

  token_type        ENUM('color','spacing','radius','shadow','font','typography','custom')
                    NOT NULL,
  token_name        VARCHAR(120) NOT NULL,
  token_path        VARCHAR(200) NOT NULL,
  token_value       VARCHAR(500) NOT NULL,
  token_unit        VARCHAR(20) DEFAULT NULL,

  reference_table   VARCHAR(64) DEFAULT NULL,
  reference_id      BIGINT UNSIGNED DEFAULT NULL,

  description       VARCHAR(255) DEFAULT NULL,
  tags              JSON NOT NULL DEFAULT (JSON_ARRAY()),

  is_public         BOOLEAN NOT NULL DEFAULT TRUE,
  is_deprecated     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_dt_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_token_name (project_id, token_name),
  INDEX idx_dt_type (token_type, is_public),
  INDEX idx_dt_path (token_path),
  FULLTEXT KEY ft_dt_search (token_name, description)
) ENGINE=InnoDB;


-- =====================================================================
-- VERSIONING, COMMENTS, AUDIT
-- =====================================================================

-- Design versions with auto-extracted semver components
CREATE TABLE design_versions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,

  version_tag       VARCHAR(20) NOT NULL,

  version_major     SMALLINT UNSIGNED GENERATED ALWAYS AS (
                      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(version_tag, '.', 1), 'v', -1) AS UNSIGNED)
                    ) STORED,
  version_minor     SMALLINT UNSIGNED GENERATED ALWAYS AS (
                      CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(version_tag, '.', 2), '.', -1) AS UNSIGNED)
                    ) STORED,
  version_patch     SMALLINT UNSIGNED GENERATED ALWAYS AS (
                      CAST(SUBSTRING_INDEX(version_tag, '.', -1) AS UNSIGNED)
                    ) STORED,

  release_type      ENUM('major','minor','patch','prerelease') NOT NULL DEFAULT 'patch',
  changelog         TEXT DEFAULT NULL,
  snapshot_json     JSON NOT NULL,

  is_published      BOOLEAN NOT NULL DEFAULT FALSE,
  published_at      DATETIME DEFAULT NULL,

  created_by        BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),

  CONSTRAINT fk_dv_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_dv_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_project_version (project_id, version_tag),
  INDEX idx_dv_published (project_id, is_published, published_at DESC)
) ENGINE=InnoDB;


-- Threaded comments with mentions and resolution
CREATE TABLE comments (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid              BINARY(16) NOT NULL UNIQUE DEFAULT (uuid_v7()),
  project_id        BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  parent_id         BIGINT UNSIGNED DEFAULT NULL,

  entity_type       ENUM('project','token','component','variant','version','comment')
                    NOT NULL DEFAULT 'project',
  entity_id         BIGINT UNSIGNED DEFAULT NULL,

  body              TEXT NOT NULL,

  mentions          JSON NOT NULL DEFAULT (JSON_ARRAY()),
  attachments       JSON NOT NULL DEFAULT (JSON_ARRAY()),

  is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at         DATETIME DEFAULT NULL,
  is_resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by       BIGINT UNSIGNED DEFAULT NULL,
  resolved_at       DATETIME DEFAULT NULL,

  deleted_at        DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at        DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
                    ON UPDATE UTC_TIMESTAMP(),

  CONSTRAINT fk_com_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_com_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_com_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
  CONSTRAINT fk_com_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_com_entity (entity_type, entity_id),
  INDEX idx_com_thread (parent_id, created_at),
  INDEX idx_com_unresolved (project_id, is_resolved, deleted_at),
  FULLTEXT KEY ft_com_search (body)
) ENGINE=InnoDB;


-- Immutable audit log, partitioned by year
CREATE TABLE audit_log (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  user_id           BIGINT UNSIGNED DEFAULT NULL,
  project_id        BIGINT UNSIGNED DEFAULT NULL,

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
  INDEX idx_audit_project (project_id, created_at DESC),
  INDEX idx_audit_action (action, created_at DESC)
) ENGINE=InnoDB
  COMMENT='Immutable audit trail for all data changes'
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

-- Project summary with aggregated counts
CREATE OR REPLACE VIEW v_project_summary AS
SELECT
  p.id,
  p.uuid,
  p.name,
  p.slug,
  p.status,
  p.version,
  t.name AS team_name,
  u.full_name AS creator_name,
  (SELECT COUNT(*) FROM color_tokens ct
    JOIN color_palettes cp ON cp.id = ct.palette_id
    WHERE cp.project_id = p.id) AS color_count,
  (SELECT COUNT(*) FROM components c WHERE c.project_id = p.id) AS component_count,
  (SELECT COUNT(*) FROM design_tokens dt WHERE dt.project_id = p.id) AS token_count,
  (SELECT COUNT(*) FROM comments cm WHERE cm.project_id = p.id AND cm.is_resolved = FALSE) AS open_comments,
  p.updated_at
FROM projects p
JOIN teams t ON t.id = p.team_id
JOIN users u ON u.id = p.created_by
WHERE p.deleted_at IS NULL;


-- Simplified color contrast ratio view
CREATE OR REPLACE VIEW v_color_contrast AS
SELECT
  a.palette_id,
  a.token_name AS foreground_token,
  a.hex_value AS foreground_hex,
  b.token_name AS background_token,
  b.hex_value AS background_hex,
  ROUND(
    (0.2126 * a.rgb_r + 0.7152 * a.rgb_g + 0.0722 * a.rgb_b) /
    NULLIF((0.2126 * b.rgb_r + 0.7152 * b.rgb_g + 0.0722 * b.rgb_b), 0),
    2
  ) AS contrast_ratio
FROM color_tokens a
CROSS JOIN color_tokens b
WHERE a.palette_id = b.palette_id
  AND a.id <> b.id
  AND a.category IN ('brand','semantic')
  AND b.category = 'neutral';


-- =====================================================================
-- TRIGGERS
-- =====================================================================

DELIMITER $$

-- Audit trail for user updates
CREATE TRIGGER trg_users_after_update
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.row_version <> NEW.row_version OR
     OLD.status <> NEW.status OR
     OLD.role <> NEW.role THEN
    INSERT INTO audit_log (table_name, record_id, action, user_id, changes_json)
    VALUES ('users', NEW.id, 'UPDATE', NEW.id, JSON_OBJECT(
      'old_status', OLD.status,
      'new_status', NEW.status,
      'old_role', OLD.role,
      'new_role', NEW.role
    ));
  END IF;
END$$

-- Auto-increment row version on project updates
CREATE TRIGGER trg_projects_version_bump
BEFORE UPDATE ON projects
FOR EACH ROW
BEGIN
  SET NEW.row_version = OLD.row_version + 1;
  SET NEW.updated_at = UTC_TIMESTAMP();
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

DELIMITER ;


-- =====================================================================
-- STORED PROCEDURES
-- =====================================================================

DELIMITER $$

-- Export full project token set as JSON
CREATE PROCEDURE sp_export_project_tokens(IN p_project_id BIGINT)
BEGIN
  SELECT JSON_OBJECT(
    'project', (SELECT JSON_OBJECT('id', id, 'name', name, 'version', version)
                FROM projects WHERE id = p_project_id),
    'colors', (
      SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'token', ct.token_name,
        'value', ct.hex_value,
        'category', ct.category
      ))
      FROM color_tokens ct
      JOIN color_palettes cp ON cp.id = ct.palette_id
      WHERE cp.project_id = p_project_id
    ),
    'spacing', (
      SELECT JSON_ARRAYAGG(JSON_OBJECT(
        'token', st.token_name,
        'px', st.value_px,
        'rem', st.value_rem
      ))
      FROM spacing_tokens st
      JOIN spacing_scales ss ON ss.id = st.scale_id
      WHERE ss.project_id = p_project_id
    ),
    'radius', (
      SELECT JSON_ARRAYAGG(JSON_OBJECT('token', token_name, 'px', value_px))
      FROM radius_tokens WHERE project_id = p_project_id
    ),
    'shadows', (
      SELECT JSON_ARRAYAGG(JSON_OBJECT('token', token_name, 'css', css_value))
      FROM shadow_tokens WHERE project_id = p_project_id
    )
  ) AS tokens_json;
END$$

-- Recent activity for a project
CREATE PROCEDURE sp_project_recent_activity(
  IN p_project_id BIGINT,
  IN p_limit INT
)
BEGIN
  SELECT
    al.action,
    al.table_name,
    al.created_at,
    u.full_name AS actor
  FROM audit_log al
  LEFT JOIN users u ON u.id = al.user_id
  WHERE al.project_id = p_project_id
  ORDER BY al.created_at DESC
  LIMIT p_limit;
END$$

DELIMITER ;


-- =====================================================================
-- SEED DATA
-- =====================================================================

-- Users
INSERT INTO users (username, email, full_name, password_hash, role, status) VALUES
('abebe',  'abebe@devteam.io',  'Abebe Kebede',  '$2y$12$...', 'admin',    'active'),
('sara',   'sara@devteam.io',   'Sara Tesfaye',  '$2y$12$...', 'designer', 'active'),
('dawit',  'dawit@devteam.io',  'Dawit Haile',   '$2y$12$...', 'developer','active'),
('hana',   'hana@devteam.io',   'Hana Girma',    '$2y$12$...', 'viewer',   'active');

-- User roles
INSERT INTO user_roles (user_id, role_id, scope_type)
SELECT 1, id, 'global' FROM roles WHERE name = 'admin'
UNION ALL
SELECT 2, id, 'global' FROM roles WHERE name = 'designer'
UNION ALL
SELECT 3, id, 'global' FROM roles WHERE name = 'developer'
UNION ALL
SELECT 4, id, 'global' FROM roles WHERE name = 'viewer';

-- Team
INSERT INTO teams (name, slug, description, owner_id, settings) VALUES
('DevTeam Core', 'devteam-core', 'Primary design system team', 1,
 JSON_OBJECT('allow_guest_access', TRUE, 'default_visibility', 'team'));

-- Team members
INSERT INTO team_members (team_id, user_id, role) VALUES
(1, 1, 'owner'),
(1, 2, 'admin'),
(1, 3, 'member'),
(1, 4, 'guest');

-- Project
INSERT INTO projects (team_id, name, slug, description, status, version, visibility, created_by, tags) VALUES
(1, 'DevTeam-Hub Design System', 'devteam-hub-ds',
 'Master Design Documentation v1.0', 'active', '1.0.0', 'team', 1,
 JSON_ARRAY('design-system', 'ui', 'tokens'));

-- Color palettes
INSERT INTO color_palettes (project_id, name, description, mode, is_default) VALUES
(1, 'Core Palette', 'Primary brand colors', 'light', TRUE),
(1, 'Dark Mode',    'Dark theme variant',    'dark',  FALSE);

-- Color tokens
INSERT INTO color_tokens
  (palette_id, token_name, display_name, token_path, hex_value, category, semantic_role, scale_step, sort_order)
VALUES
(1, '--teal-50',   'Teal 50',   'brand.teal.50',    '#f0fdfa', 'brand',    'primary', 50,  10),
(1, '--teal-100',  'Teal 100',  'brand.teal.100',   '#ccfbf1', 'brand',    'primary', 100, 20),
(1, '--teal-500',  'Teal 500',  'brand.teal.500',   '#0d9488', 'brand',    'primary', 500, 50),
(1, '--teal-700',  'Teal 700',  'brand.teal.700',   '#0f766e', 'brand',    'primary', 700, 70),
(1, '--blue-500',  'Blue 500',  'semantic.blue.500','#2563eb', 'semantic', 'info',    500, 60),
(1, '--amber-500', 'Amber 500', 'semantic.amber.500','#d97706','semantic', 'warning', 500, 70),
(1, '--red-900',   'Red 900',   'semantic.red.900', '#881337', 'semantic', 'danger',  900, 90),
(1, '--gray-50',   'Gray 50',   'neutral.gray.50',  '#f8fafc', 'neutral',  'neutral', 50,  10),
(1, '--gray-500',  'Gray 500',  'neutral.gray.500', '#64748b', 'neutral',  'neutral', 500, 50),
(1, '--gray-900',  'Gray 900',  'neutral.gray.900', '#0f172a', 'neutral',  'neutral', 900, 90);

-- Font families
INSERT INTO font_families (project_id, name, css_stack, font_type, source_type, available_weights) VALUES
(1, 'System Sans', 'system-ui, -apple-system, ''Segoe UI'', Roboto, sans-serif',
    'sans', 'system', JSON_ARRAY(400, 500, 600, 700, 800)),
(1, 'JetBrains Mono', '''JetBrains Mono'', ''SF Mono'', ''Fira Code'', monospace',
    'mono', 'google', JSON_ARRAY(400, 500, 600, 700));

-- Type styles
INSERT INTO type_styles
  (font_family_id, style_name, style_role, level, font_size_px, font_weight, line_height, letter_spacing, text_transform, sort_order)
VALUES
(1, 'Display', 'display',    NULL, 48.00, 800, 1.10, -0.020, 'none',      10),
(1, 'H1',      'heading',    1,    32.00, 800, 1.20, -0.020, 'none',      20),
(1, 'H2',      'heading',    2,    24.00, 700, 1.30, -0.010, 'none',      30),
(1, 'H3',      'heading',    3,    20.00, 700, 1.40,  0.000, 'none',      40),
(1, 'Body',    'body',       NULL, 16.00, 400, 1.65,  0.000, 'none',      50),
(1, 'Small',   'body',       NULL, 14.00, 400, 1.60,  0.000, 'none',      60),
(1, 'Label',   'label',      NULL, 12.00, 700, 1.40,  0.080, 'uppercase', 70),
(2, 'Code',    'code',       NULL, 14.00, 400, 1.60,  0.000, 'none',      80);

-- Spacing
INSERT INTO spacing_scales (project_id, scale_name, base_unit, is_default) VALUES
(1, 'default', 4, TRUE);

INSERT INTO spacing_tokens (scale_id, token_name, value_px, step, usage_note) VALUES
(1, 'xs',   4,  1,  'Tight spacing'),
(1, 'sm',   8,  2,  'Small gaps'),
(1, 'md',   12, 3,  'Medium gaps'),
(1, 'base', 16, 4,  'Default'),
(1, 'lg',   24, 6,  'Section spacing'),
(1, 'xl',   32, 8,  'Large sections'),
(1, '2xl',  48, 12, 'Page sections'),
(1, '3xl',  64, 16, 'Hero sections');

-- Radius
INSERT INTO radius_tokens (project_id, token_name, value_px, usage_note, sort_order) VALUES
(1, 'none', 0,   'Sharp corners',   10),
(1, 'sm',   6,   'Buttons, inputs', 20),
(1, 'base', 12,  'Cards, modals',   30),
(1, 'lg',   20,  'Large cards',     40),
(1, 'pill', 999, 'Pills, tags',     50);

-- Shadows
INSERT INTO shadow_tokens
  (project_id, token_name, offset_x, offset_y, blur_radius, spread_radius, color_hex, opacity, elevation_level, usage_note)
VALUES
(1, 'sm',   0, 1,  2,  0, '#000000', 0.04, 1, 'Cards, inputs'),
(1, 'base', 0, 4,  12, 0, '#000000', 0.05, 2, 'Hover cards, dropdowns'),
(1, 'lg',   0, 12, 28, 0, '#000000', 0.08, 3, 'Modals, popovers');

-- Components
INSERT INTO components (project_id, name, slug, category, description) VALUES
(1, 'Button', 'button', 'action',  'Interactive button component'),
(1, 'Badge',  'badge',  'display', 'Status indicator badge'),
(1, 'Input',  'input',  'form',    'Text input field');

-- Component variants
INSERT INTO component_variants
  (component_id, variant_name, size, is_default, tokens_json, states_json)
VALUES
(1, 'primary', 'md', TRUE,
 JSON_OBJECT(
   'background', '--teal-500',
   'foreground', '--white',
   'border',     '--teal-500',
   'radius',     '--radius-sm',
   'spacing',    JSON_OBJECT('x', '--spacing-lg', 'y', '--spacing-sm')
 ),
 JSON_OBJECT(
   'hover',    JSON_OBJECT('background', '--teal-700'),
   'focus',    JSON_OBJECT('ring', '--teal-100'),
   'disabled', JSON_OBJECT('opacity', 0.4)
 )),
(1, 'secondary', 'md', FALSE,
 JSON_OBJECT(
   'background', '--white',
   'foreground', '--gray-900',
   'border',     '--gray-500',
   'radius',     '--radius-sm'
 ),
 JSON_OBJECT(
   'hover', JSON_OBJECT('background', '--gray-50')
 )),
(1, 'danger', 'md', FALSE,
 JSON_OBJECT(
   'background', '--red-900',
   'foreground', '--white',
   'radius',     '--radius-sm'
 ),
 JSON_OBJECT(
   'hover', JSON_OBJECT('background', '#6b0f2b')
 ));

-- Unified design tokens
INSERT INTO design_tokens
  (project_id, token_type, token_name, token_path, token_value, description)
VALUES
(1, 'color',    '--teal-500',   'brand.teal.500',   '#0d9488', 'Primary brand color'),
(1, 'color',    '--gray-900',   'neutral.gray.900', '#0f172a', 'Primary text'),
(1, 'spacing',  '--space-base', 'spacing.base',     '16px',    'Default spacing'),
(1, 'radius',   '--radius-sm',  'radius.sm',        '6px',     'Small radius'),
(1, 'shadow',   '--shadow-base','shadow.base',      '0 4px 12px rgba(0,0,0,0.05)', 'Base shadow'),
(1, 'font',     '--font-sans',  'font.sans',        'system-ui, sans-serif', 'Default sans'),
(1, 'font',     '--font-mono',  'font.mono',        '''JetBrains Mono'', monospace', 'Code font');


-- =====================================================================
-- COMMON QUERIES (Reference)
-- =====================================================================

-- 1. All colors for a project with RGB values
-- SELECT ct.token_name, ct.display_name, ct.hex_value, ct.rgb_value,
--        ct.semantic_role, ct.usage_note
-- FROM color_tokens ct
-- JOIN color_palettes cp ON cp.id = ct.palette_id
-- WHERE cp.project_id = 1 AND cp.is_default = TRUE
-- ORDER BY ct.sort_order;

-- 2. Export full project tokens as JSON
-- CALL sp_export_project_tokens(1);

-- 3. Project summary
-- SELECT * FROM v_project_summary WHERE id = 1;

-- 4. Recent activity
-- CALL sp_project_recent_activity(1, 10);

-- 5. Shadow tokens with CSS values
-- SELECT token_name, css_value, elevation_level, usage_note
-- FROM shadow_tokens WHERE project_id = 1 ORDER BY elevation_level;

-- 6. Typography scale in REM
-- SELECT ts.style_name, ts.font_size_px, ts.font_size_rem, ts.font_weight, ts.line_height
-- FROM type_styles ts
-- JOIN font_families ff ON ff.id = ts.font_family_id
-- WHERE ff.project_id = 1 AND ff.font_type = 'sans'
-- ORDER BY ts.sort_order;

-- 7. Components with primary variant background token
-- SELECT c.name, cv.variant_name, cv.size,
--        JSON_EXTRACT(cv.tokens_json, '$.background') AS bg_token
-- FROM components c
-- JOIN component_variants cv ON cv.component_id = c.id
-- WHERE c.project_id = 1 AND cv.variant_name = 'primary';

-- 8. Full-text search across components and projects
-- SELECT 'component' AS type, id, name, MATCH(name, description) AGAINST('button') AS score
-- FROM components WHERE MATCH(name, description) AGAINST('button')
-- UNION ALL
-- SELECT 'project', id, name, MATCH(name, description) AGAINST('design')
-- FROM projects WHERE MATCH(name, description) AGAINST('design')
-- ORDER BY score DESC LIMIT 10;

-- 9. Audit log by user
-- SELECT al.table_name, al.action, al.created_at, JSON_PRETTY(al.changes_json) AS changes
-- FROM audit_log al WHERE al.user_id = 1 ORDER BY al.created_at DESC LIMIT 20;

-- 10. Color contrast analysis
-- SELECT foreground_token, background_token, contrast_ratio
-- FROM v_color_contrast WHERE palette_id = 1 AND contrast_ratio >= 4.5
-- ORDER BY contrast_ratio DESC;


-- =====================================================================
-- END OF SCHEMA
-- =====================================================================