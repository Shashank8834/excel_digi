const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'compliance-tracker-secret-key-2024';

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Middleware to require admin role
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// Middleware to require manager or admin role
function requireManager(req, res, next) {
    if (req.user.role !== 'manager' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Manager access required' });
    }
    next();
}

// Middleware to check if user can access client data
function canAccessClient(req, res, next) {
    const { db } = require('../db/database');
    const clientId = req.params.clientId || req.body.clientId;

    if (!clientId) {
        return next();
    }

    // Admins and managers can access all clients
    if (req.user.role === 'admin' || req.user.role === 'manager') {
        return next();
    }

    // Team members can only access their assigned clients
    const assignment = db.prepare(`
        SELECT 1 FROM user_client_assignments 
        WHERE user_id = ? AND client_id = ?
    `).get(req.user.id, clientId);

    if (!assignment) {
        return res.status(403).json({ error: 'You do not have access to this client' });
    }

    next();
}

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

module.exports = {
    authenticateToken,
    requireAdmin,
    requireManager,
    canAccessClient,
    generateToken,
    JWT_SECRET
};
