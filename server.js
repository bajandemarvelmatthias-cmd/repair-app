const express = require('express');
const path = require('node:path');

require('./db/database'); // creates the database and tables on first run

const { authenticate, requireRole } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Public
app.use('/api/auth', require('./routes/auth'));

// Authenticated (customer and admin)
app.use('/api/catalog', authenticate, require('./routes/catalog'));
app.use('/api/assessments', authenticate, require('./routes/assessments'));
app.use('/api/guides', authenticate, require('./routes/guides'));
app.use('/api/simulations', authenticate, require('./routes/simulations'));
app.use('/api/progress', authenticate, require('./routes/progress'));

// Admin only
app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// Frontend (built in the next stage)
app.use(express.static(path.join(__dirname, 'public')));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
