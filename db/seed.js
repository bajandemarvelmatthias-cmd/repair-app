const { db, transaction } = require('./database');
const { hashPassword } = require('../utils/auth');

const ins = (sql, ...params) => db.prepare(sql).run(...params).lastInsertRowid;

transaction(() => {
  // ---- Default admin ----
  const email = (process.env.ADMIN_EMAIL || 'admin@repairapp.local').toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!exists) {
    ins(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
      process.env.ADMIN_NAME || 'Administrator',
      email,
      hashPassword(process.env.ADMIN_PASSWORD || 'Admin@12345')
    );
    console.log(`Admin created: ${email}`);
  } else {
    console.log('Admin already exists, skipped.');
  }

  // ---- Sample content (only when empty) ----
  if (db.prepare('SELECT COUNT(*) AS n FROM device_categories').get().n > 0) {
    console.log('Sample content already present, skipped.');
    return;
  }

  const phone = ins('INSERT INTO device_categories (name, description) VALUES (?, ?)', 'Smartphone', 'Mobile phones');
  const laptop = ins('INSERT INTO device_categories (name, description) VALUES (?, ?)', 'Laptop', 'Notebook computers');
  const tablet = ins('INSERT INTO device_categories (name, description) VALUES (?, ?)', 'Tablet', 'Tablet devices');

  const dev = (c, b, m) => ins('INSERT INTO devices (category_id, brand, model) VALUES (?, ?, ?)', c, b, m);
  dev(phone, 'Samsung', 'Galaxy A54');
  dev(phone, 'Apple', 'iPhone 12');
  dev(laptop, 'Lenovo', 'IdeaPad 3');
  dev(laptop, 'Dell', 'Inspiron 15');
  dev(tablet, 'Apple', 'iPad 9th Gen');

  const sym = (c, n, d) => ins('INSERT INTO symptoms (category_id, name, description) VALUES (?, ?, ?)', c, n, d);
  const battery = sym(phone, 'Battery drains quickly', 'Charge drops fast even with light use');
  const noCharge = sym(phone, 'Will not charge', 'Phone does not charge or charges intermittently');
  const cracked = sym(phone, 'Cracked or unresponsive screen', 'Visible cracks or touch not responding');
  const overheat = sym(laptop, 'Overheating or loud fan', 'Hot chassis, fan running constantly');
  const noPower = sym(laptop, 'Will not power on', 'No lights, no display, no sound');
  const flicker = sym(tablet, 'Screen flickers', 'Display flashes or shows lines');
  const restarts = sym(null, 'Random restarts', 'Device restarts or freezes without warning');

  const rule = (s, area, sev, steps, pr = 1) =>
    ins('INSERT INTO assessment_rules (symptom_id, area_of_concern, severity, next_steps, priority) VALUES (?, ?, ?, ?, ?)', s, area, sev, steps, pr);
  rule(battery, 'Aging battery', 'medium', 'Check battery health in settings. Close background apps. Consider a battery replacement if health is below 80%.', 1);
  rule(battery, 'Background apps or software', 'low', 'Review battery usage by app and update the operating system.', 2);
  rule(noCharge, 'Charging port debris', 'low', 'Power off the phone and gently clean the port with a wooden or plastic pick.', 1);
  rule(noCharge, 'Faulty cable or adapter', 'low', 'Try a different cable and wall adapter.', 2);
  rule(noCharge, 'Damaged charging port or battery', 'high', 'If the above fails, stop and have the phone inspected by a technician.', 3);
  rule(cracked, 'Damaged display assembly', 'high', 'Avoid using a badly cracked screen. Back up data and seek display replacement.', 1);
  rule(overheat, 'Dust buildup in fan and vents', 'medium', 'Power off, unplug, and clean vents with compressed air.', 1);
  rule(overheat, 'Dried thermal paste', 'high', 'If cleaning does not help, thermal paste replacement may be needed.', 2);
  rule(noPower, 'Power supply or battery', 'medium', 'Try a different charger, remove the battery if removable, and hold the power button for 30 seconds.', 1);
  rule(noPower, 'Motherboard or display fault', 'high', 'If there are still no signs of life, consult a technician.', 2);
  rule(flicker, 'Software or display settings', 'low', 'Restart, update the OS, and disable auto-brightness to test.', 1);
  rule(flicker, 'Loose or damaged display cable', 'high', 'If flicker persists, the display connection may need professional inspection.', 2);
  rule(restarts, 'Software corruption or overheating', 'medium', 'Update the system, free up storage, and check for overheating.', 1);

  const guide = (c, s, title, summary, diff, mins, tools, steps) => {
    const id = ins(
      'INSERT INTO repair_guides (device_category_id, symptom_id, title, summary, difficulty, estimated_minutes, tools) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c, s, title, summary, diff, mins, tools
    );
    steps.forEach(([t, i, cau], idx) =>
      ins('INSERT INTO guide_steps (guide_id, step_number, title, instruction, caution) VALUES (?, ?, ?, ?, ?)', id, idx + 1, t, i, cau || null)
    );
    return id;
  };

  const chargeGuide = guide(phone, noCharge, 'Diagnosing a Phone That Will Not Charge',
    'Rule out cable, adapter and port problems before suspecting the battery.', 'beginner', 15,
    'Wooden toothpick, spare cable, spare adapter', [
      ['Power off the phone', 'Turn the phone off completely before inspecting anything.', null],
      ['Test another cable and adapter', 'Swap in a known-good cable and wall adapter. Avoid using a computer USB port for this test.', null],
      ['Inspect the charging port', 'Shine a light into the port and look for lint or debris.', 'Never use metal objects inside the port.'],
      ['Clean the port', 'Gently scrape out lint using a wooden toothpick, then retry charging.', 'Do not press hard or bend the contacts.'],
      ['Decide next action', 'If the phone still does not charge, stop and seek professional inspection.', null]
    ]);

  guide(phone, battery, 'Before Replacing a Phone Battery',
    'Check battery health and safe handling before deciding to replace.', 'intermediate', 45,
    'Plastic opening tools, suction handle, replacement battery', [
      ['Check battery health', 'Open the battery health page in settings and note the maximum capacity.', null],
      ['Back up your data', 'Create a full backup before opening the device.', null],
      ['Discharge and power off', 'Let the battery run low, then power off.', 'Do not open a fully charged battery.'],
      ['Handle the battery safely', 'Never puncture or bend a lithium battery. Use plastic tools only.', 'A swollen battery must be handled by a professional.']
    ]);

  const fanGuide = guide(laptop, overheat, 'Cleaning a Laptop Fan and Vents',
    'Remove dust to restore airflow and reduce heat.', 'beginner', 30,
    'Small screwdriver set, compressed air, soft brush', [
      ['Power off and unplug', 'Shut the laptop down and disconnect the charger.', null],
      ['Open the back panel', 'Remove the screws holding the bottom cover and lift it carefully.', 'Keep track of screw positions.'],
      ['Clean the fan and vents', 'Hold the fan blades still and blow short bursts of compressed air through the vents.', 'Do not let the fan spin freely at high speed.'],
      ['Reassemble and test', 'Close the cover, power on, and monitor temperatures under load.', null]
    ]);

  const sim = (g, title, desc, diff, steps) => {
    const id = ins('INSERT INTO simulations (guide_id, title, description, difficulty) VALUES (?, ?, ?, ?)', g, title, desc, diff);
    steps.forEach((s, idx) =>
      ins(
        'INSERT INTO simulation_steps (simulation_id, step_number, scenario, question, options, correct_index, feedback_correct, feedback_incorrect, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, idx + 1, s.scenario, s.question, JSON.stringify(s.options), s.correct, s.ok, s.no, s.points || 10
      )
    );
  };

  sim(chargeGuide, 'Simulation: Phone Will Not Charge',
    'Practice a safe diagnosis order for a phone that will not charge.', 'beginner', [
      { scenario: 'A customer says their phone stopped charging this morning.', question: 'What should you check first?',
        options: ['Open the phone and replace the battery', 'Try a different cable and adapter', 'Reset the phone to factory settings'], correct: 1,
        ok: 'Correct. Always rule out the cheapest, simplest causes first.', no: 'Not yet. Start with the simplest cause: the cable and adapter.' },
      { scenario: 'A different cable and adapter did not help. You see lint inside the port.', question: 'Which tool is safest to clean the port?',
        options: ['A metal paperclip', 'A wooden toothpick', 'A needle'], correct: 1,
        ok: 'Correct. Non-conductive tools avoid shorting or bending contacts.', no: 'Metal tools can damage or short the contacts. Use a non-conductive pick.' },
      { scenario: 'After cleaning, the phone still does not charge.', question: 'What is the best next step?',
        options: ['Keep forcing the cable in', 'Seek professional inspection', 'Charge it overnight anyway'], correct: 1,
        ok: 'Correct. Persistent failure may mean a damaged port or battery.', no: 'Forcing or waiting can cause more damage. Seek a technician.' }
    ]);

  sim(fanGuide, 'Simulation: Laptop Overheating',
    'Practice cleaning a laptop cooling system safely.', 'beginner', [
      { scenario: 'A laptop is very hot and the fan is loud.', question: 'What must you do before opening it?',
        options: ['Power off and unplug it', 'Leave it running to watch the fan', 'Only close the lid'], correct: 0,
        ok: 'Correct. Always remove power first.', no: 'Opening a powered device is unsafe. Power off and unplug.' },
      { scenario: 'You are about to blow compressed air through the fan.', question: 'How should you handle the fan blades?',
        options: ['Let them spin freely at full speed', 'Hold them still while cleaning', 'Spray liquid cleaner on them'], correct: 1,
        ok: 'Correct. Spinning the fan too fast can damage the bearings.', no: 'Hold the blades still and use short bursts of air only.' },
      { scenario: 'The vents are clean but the laptop still overheats under load.', question: 'What is a likely remaining cause?',
        options: ['Dried thermal paste', 'The wallpaper', 'The keyboard layout'], correct: 0,
        ok: 'Correct. Thermal paste dries out over time and needs replacement.', no: 'Think about what transfers heat from the processor to the heatsink.' }
    ]);

  console.log('Sample content added.');
});
