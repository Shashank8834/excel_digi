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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for all non-API routes (SPA support)
app.get('*', (req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    } else {
        next();
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function startServer() {
    try {
        // Initialize sql.js first
        await initDatabase();

        // Then initialize schema and seed data
        await initializeDatabase();
        seedDemoData();

        // Now load the routes (after database is ready)
        app.use('/api/auth', require('./routes/auth'));
        app.use('/api/clients', require('./routes/clients'));
        app.use('/api/teams', require('./routes/teams'));
        app.use('/api/users', require('./routes/users'));
        app.use('/api/law-groups', require('./routes/lawGroups'));
        app.use('/api/compliances', require('./routes/compliances'));
        app.use('/api/status', require('./routes/status'));

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
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
