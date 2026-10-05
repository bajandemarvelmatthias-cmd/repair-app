// Optional sample catalog. Everything here lives in the database and can be edited or deleted from /admin.
const { db, transaction } = require('./database');
require('./cms-schema');
const ins = (sql, ...p) => db.prepare(sql).run(...p).lastInsertRowid;

transaction(() => {
  if (db.prepare('SELECT COUNT(*) n FROM cms_categories').get().n > 0) return console.log('CMS catalog already present, skipped.');
  const cat = (name, slug, desc, order, status = 'published') => ins('INSERT INTO cms_categories (name,slug,description,status,sort_order) VALUES (?,?,?,?,?)', name, slug, desc, status, order);
  const phones = cat('Phones', 'phones', 'Smartphone repair guides', 1);
  const laptops = cat('Laptops', 'laptops', 'Notebook repair guides', 2);
  cat('Tablets', 'tablets', 'Tablet repair guides', 3);
  cat('Game Consoles', 'game-consoles', 'Console repair guides', 4, 'draft');

  const brand = (c, name, slug, order, status = 'published') => ins('INSERT INTO cms_brands (category_id,name,slug,status,sort_order) VALUES (?,?,?,?,?)', c, name, slug, status, order);
  const apple = brand(phones, 'Apple', 'apple', 1), samsung = brand(phones, 'Samsung', 'samsung', 2);
  brand(phones, 'Google', 'google', 3, 'draft'); brand(laptops, 'Lenovo', 'lenovo', 1);

  const dev = (b, c, name, slug, model, year, status = 'published', specs = {}) =>
    ins('INSERT INTO cms_devices (brand_id,category_id,name,slug,model_number,release_year,description,specs,status) VALUES (?,?,?,?,?,?,?,?,?)',
      b, c, name, slug, model, year, `Repair information and guides for the ${name}.`, JSON.stringify(specs), status);
  const ip16p = dev(apple, phones, 'iPhone 16 Pro', 'iphone-16-pro', 'A3293', 2024, 'published', { 'Screen size': '6.3 in', Processor: 'A18 Pro' });
  dev(apple, phones, 'iPhone 16', 'iphone-16', 'A3287', 2024); dev(apple, phones, 'iPhone 15', 'iphone-15', 'A3090', 2023);
  dev(apple, phones, 'iPhone 17 (unreleased draft)', 'iphone-17', null, 2025, 'draft');
  dev(samsung, phones, 'Galaxy S24', 'galaxy-s24', 'SM-S921', 2024);

  const tool = (name, desc) => ins("INSERT INTO cms_tools (name,description,status) VALUES (?,?, 'published')", name, desc);
  const driver = tool('Precision Screwdriver Set', 'Pentalobe and Phillips bits'), pick = tool('Plastic Opening Pick', 'Pry panels without scratching'), heat = tool('Heat Gun / Hair Dryer', 'Soften adhesive');
  const battery = ins("INSERT INTO cms_parts (device_id,name,part_type,description,compatibility,status) VALUES (?,?,?,?,?, 'published')", ip16p, 'iPhone 16 Pro Battery', 'Battery', 'Replacement lithium-ion battery', 'iPhone 16 Pro (A3293)');

  const guide = (d, title, slug, rc, desc, diff, mins, order, status) =>
    ins('INSERT INTO cms_guides (device_id,title,slug,repair_category,short_description,difficulty,estimated_minutes,sort_order,status) VALUES (?,?,?,?,?,?,?,?,?)', d, title, slug, rc, desc, diff, mins, order, status);
  const bat = guide(ip16p, 'Battery Replacement', 'battery-replacement', 'Battery', 'Replace a worn-out battery to restore battery life.', 'moderate', 45, 1, 'published');
  guide(ip16p, 'Screen Replacement', 'screen-replacement', 'Screen', 'Replace a cracked display.', 'difficult', 60, 2, 'draft');
  ins('INSERT INTO cms_guide_tools VALUES (?,?)', bat, driver); ins('INSERT INTO cms_guide_tools VALUES (?,?)', bat, pick); ins('INSERT INTO cms_guide_tools VALUES (?,?)', bat, heat);
  ins('INSERT INTO cms_guide_parts VALUES (?,?)', bat, battery);

  const step = (n, title, text, warning, tip) => ins('INSERT INTO cms_steps (guide_id,step_number,title,instructions,warning,tip) VALUES (?,?,?,?,?,?)', bat, n, title, text, warning, tip);
  const s1 = step(1, 'Power off and remove the bottom screws', 'Power the phone off, then use the precision screwdriver to remove the two bottom screws.', 'Never open a powered-on phone.', 'Keep screws in a tray in the order you removed them.');
  step(2, 'Heat and lift the screen', 'Warm the edges for about a minute, then slowly lift the screen with a suction handle and opening pick.', 'Do not pry near the display cable.', null);
  step(3, 'Swap the battery', 'Disconnect the battery connector, release the adhesive tabs, and fit the new battery.', 'Do not puncture or bend the battery.', null);
  ins('INSERT INTO cms_step_tools VALUES (?,?)', s1, driver);
  ins('INSERT INTO cms_activity (message) VALUES (?)', 'Sample catalog created');
  console.log('CMS sample catalog created.');
});
