// CMS tables: Category -> Brand -> Device -> Guide -> Step, plus tools, parts, media.
const { db } = require('./database');

try { db.exec("ALTER TABLE users ADD COLUMN admin_role TEXT"); } catch {} // super_admin | content_admin | editor

db.exec(`
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL, original_name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'image', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cms_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  description TEXT, image TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cms_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES cms_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, logo TEXT, description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (category_id, slug)
);
CREATE TABLE IF NOT EXISTS cms_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, brand_id INTEGER NOT NULL REFERENCES cms_brands(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES cms_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL, model_number TEXT, release_year INTEGER, description TEXT,
  image TEXT, gallery TEXT NOT NULL DEFAULT '[]', specs TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (brand_id, slug)
);
CREATE TABLE IF NOT EXISTS cms_tools (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, image TEXT, brand TEXT, link TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))
);
CREATE TABLE IF NOT EXISTS cms_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER REFERENCES cms_devices(id) ON DELETE SET NULL,
  name TEXT NOT NULL, part_type TEXT, description TEXT, image TEXT, link TEXT, compatibility TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))
);
CREATE TABLE IF NOT EXISTS cms_guides (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL REFERENCES cms_devices(id) ON DELETE CASCADE,
  title TEXT NOT NULL, slug TEXT NOT NULL, repair_category TEXT, short_description TEXT,
  difficulty TEXT NOT NULL DEFAULT 'easy' CHECK (difficulty IN ('easy','moderate','difficult')),
  estimated_minutes INTEGER, cover_image TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (device_id, slug)
);
CREATE TABLE IF NOT EXISTS cms_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guide_id INTEGER NOT NULL REFERENCES cms_guides(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL, title TEXT NOT NULL, instructions TEXT, images TEXT NOT NULL DEFAULT '[]',
  video TEXT, warning TEXT, tip TEXT
);
CREATE TABLE IF NOT EXISTS cms_guide_tools (
  guide_id INTEGER NOT NULL REFERENCES cms_guides(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES cms_tools(id) ON DELETE CASCADE, PRIMARY KEY (guide_id, tool_id)
);
CREATE TABLE IF NOT EXISTS cms_guide_parts (
  guide_id INTEGER NOT NULL REFERENCES cms_guides(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES cms_parts(id) ON DELETE CASCADE, PRIMARY KEY (guide_id, part_id)
);
CREATE TABLE IF NOT EXISTS cms_step_tools (
  step_id INTEGER NOT NULL REFERENCES cms_steps(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES cms_tools(id) ON DELETE CASCADE, PRIMARY KEY (step_id, tool_id)
);
CREATE TABLE IF NOT EXISTS cms_step_parts (
  step_id INTEGER NOT NULL REFERENCES cms_steps(id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES cms_parts(id) ON DELETE CASCADE, PRIMARY KEY (step_id, part_id)
);
CREATE TABLE IF NOT EXISTS cms_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cms_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_cms_dev_brand ON cms_devices(brand_id);
CREATE INDEX IF NOT EXISTS idx_cms_guide_dev ON cms_guides(device_id);
CREATE INDEX IF NOT EXISTS idx_cms_step_guide ON cms_steps(guide_id);
`);
// Existing single admin becomes Super Admin.
db.exec("UPDATE users SET admin_role='super_admin' WHERE role='admin' AND admin_role IS NULL");
