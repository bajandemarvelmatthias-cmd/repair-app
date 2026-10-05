// Public catalog API: no login, published content only, everything read from the database.
const express = require('express');
const { db } = require('../db/database');
const { HttpError } = require('../utils/http');
const router = express.Router();
const jarr = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const jobj = (v) => { try { return JSON.parse(v || '{}'); } catch { return {}; } };

router.get('/categories', (req, res) => {
  res.json(db.prepare(`SELECT id, name, slug, description, image FROM cms_categories WHERE status='published' ORDER BY sort_order, name`).all());
});

router.get('/categories/:slug', (req, res) => {
  const cat = db.prepare(`SELECT id, name, slug, description, image FROM cms_categories WHERE slug=? AND status='published'`).get(req.params.slug);
  if (!cat) throw new HttpError(404, 'Category not found.');
  const brands = db.prepare(`SELECT id, name, slug, logo, description FROM cms_brands WHERE category_id=? AND status='published' ORDER BY sort_order, name`).all(cat.id);
  res.json({ ...cat, brands });
});

router.get('/categories/:cat/brands/:brand', (req, res) => {
  const row = db.prepare(`SELECT b.id, b.name, b.slug, b.logo, b.description, c.name AS category, c.slug AS category_slug
    FROM cms_brands b JOIN cms_categories c ON c.id=b.category_id
    WHERE c.slug=? AND b.slug=? AND b.status='published' AND c.status='published'`).get(req.params.cat, req.params.brand);
  if (!row) throw new HttpError(404, 'Brand not found.');
  const devices = db.prepare(`SELECT id, name, slug, model_number, release_year, image, description FROM cms_devices
    WHERE brand_id=? AND status='published' ORDER BY release_year DESC, name DESC`).all(row.id);
  res.json({ ...row, devices });
});

router.get('/devices/:id', (req, res) => {
  const d = db.prepare(`SELECT d.*, b.name AS brand, b.slug AS brand_slug, c.name AS category, c.slug AS category_slug
    FROM cms_devices d JOIN cms_brands b ON b.id=d.brand_id JOIN cms_categories c ON c.id=d.category_id
    WHERE d.id=? AND d.status='published' AND b.status='published' AND c.status='published'`).get(Number(req.params.id));
  if (!d) throw new HttpError(404, 'Device not found.');
  const guides = db.prepare(`SELECT id, title, slug, repair_category, short_description, difficulty, estimated_minutes, cover_image
    FROM cms_guides WHERE device_id=? AND status='published' ORDER BY sort_order, id`).all(d.id);
  res.json({ ...d, gallery: jarr(d.gallery), specs: jobj(d.specs), guides });
});

router.get('/guides/:id', (req, res) => {
  const g = db.prepare(`SELECT g.*, d.name AS device, d.id AS device_id, d.image AS device_image, b.name AS brand
    FROM cms_guides g JOIN cms_devices d ON d.id=g.device_id JOIN cms_brands b ON b.id=d.brand_id
    WHERE g.id=? AND g.status='published' AND d.status='published' AND b.status='published'`).get(Number(req.params.id));
  if (!g) throw new HttpError(404, 'Guide not found.');
  const pubTools = `SELECT t.id,t.name,t.description,t.image,t.link FROM cms_tools t WHERE t.status='published'`;
  const pubParts = `SELECT p.id,p.name,p.part_type,p.description,p.image,p.link FROM cms_parts p WHERE p.status='published'`;
  const steps = db.prepare('SELECT * FROM cms_steps WHERE guide_id=? ORDER BY step_number').all(g.id).map((s) => ({
    step_number: s.step_number, title: s.title, instructions: s.instructions, images: jarr(s.images), video: s.video, warning: s.warning, tip: s.tip,
    tools: db.prepare(`${pubTools} AND t.id IN (SELECT tool_id FROM cms_step_tools WHERE step_id=?)`).all(s.id),
    parts: db.prepare(`${pubParts} AND p.id IN (SELECT part_id FROM cms_step_parts WHERE step_id=?)`).all(s.id)
  }));
  res.json({
    id: g.id, title: g.title, device: g.device, device_id: g.device_id, brand: g.brand, repair_category: g.repair_category,
    short_description: g.short_description, difficulty: g.difficulty, estimated_minutes: g.estimated_minutes, cover_image: g.cover_image || g.device_image,
    tools: db.prepare(`${pubTools} AND t.id IN (SELECT tool_id FROM cms_guide_tools WHERE guide_id=?)`).all(g.id),
    parts: db.prepare(`${pubParts} AND p.id IN (SELECT part_id FROM cms_guide_parts WHERE guide_id=?)`).all(g.id),
    steps
  });
});

// Global search over published devices, brands and guides. Words are matched independently,
// so "iphone battery" finds the iPhone devices and any "Battery ..." guide.
router.get('/search', (req, res) => {
  const words = String(req.query.q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return res.json({ devices: [], brands: [], guides: [] });
  const like = (cols) => words.map(() => `(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`).join(' AND ');
  const args = (n) => words.flatMap((w) => Array(n).fill(`%${w}%`));
  const brands = db.prepare(`SELECT b.id, b.name, b.slug, b.logo, c.slug AS category_slug, c.name AS category FROM cms_brands b JOIN cms_categories c ON c.id=b.category_id
    WHERE b.status='published' AND c.status='published' AND ${like(['b.name'])} LIMIT 10`).all(...args(1));
  const devices = db.prepare(`SELECT d.id, d.name, d.image, d.model_number, b.name AS brand FROM cms_devices d JOIN cms_brands b ON b.id=d.brand_id
    WHERE d.status='published' AND b.status='published' AND ${like(['d.name', 'b.name', 'd.model_number'])} LIMIT 20`).all(...args(3));
  const guides = db.prepare(`SELECT g.id, g.title, g.short_description, d.name AS device, d.id AS device_id FROM cms_guides g
    JOIN cms_devices d ON d.id=g.device_id JOIN cms_brands b ON b.id=d.brand_id
    WHERE g.status='published' AND d.status='published' AND b.status='published'
    AND ${like(['g.title', 'g.short_description', 'g.repair_category', 'd.name', 'b.name'])} LIMIT 20`).all(...args(5));
  res.json({ devices, brands, guides });
});

router.get('/settings', (req, res) => {
  const s = Object.fromEntries(db.prepare('SELECT key,value FROM cms_settings').all().map((r) => [r.key, r.value]));
  res.json({ site_name: s.site_name || 'LunasTech', tagline: s.tagline || 'DIY repair guides for everyday devices' });
});

module.exports = router;
