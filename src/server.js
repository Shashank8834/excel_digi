const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase, seedDemoData, initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Track initialization
let isInitialized = false;

// Initialize database before handling requests
async function ensureInitialized() {
    if (isInitialized) return;

    try {
        await initDatabase();
        await initializeDatabase();
        seedDemoData();
        isInitialized = true;
        console.log('Database initialized');
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    }
}

// Middleware to ensure DB is ready
app.use(async (req, res, next) => {
    try {
        await ensureInitialized();
        next();
    } catch (error) {
        console.error('DB init middleware error:', error);
        res.status(500).json({
            error: 'Database initialization failed',
            details: error.message,
            stack: error.stack
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/users', require('./routes/users'));
app.use('/api/law-groups', require('./routes/lawGroups'));
app.use('/api/compliances', require('./routes/compliances'));
app.use('/api/status', require('./routes/status'));

// Serve index.html for all non-API routes (SPA support)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════════════════════╗
║        Compliance Work Tracker Server Started            ║
╠══════════════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                          ║
║                                                          ║
║  Login:   manager@company.com / password123              ║
║                                                          ║
║  Manager can add teams, users, clients, and law groups.  ║
╚══════════════════════════════════════════════════════════╝
        `);
    });
}

// Export for Vercel serverless
module.exports = app;
