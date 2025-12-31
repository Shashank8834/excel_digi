const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all users (manager only)
router.get('/', authenticateToken, requireManager, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT u.id, u.name, u.email, u.role, u.team_id, t.name as team_name, u.created_at
            FROM users u
            LEFT JOIN teams t ON u.team_id = t.id
            ORDER BY u.name
        `).all();

        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Create user (manager only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, email, role, team_id } = req.body;
        // Default password is 'password123' if not provided
        const password = req.body.password || 'password123';

        if (!name || !email || !role) {
            return res.status(400).json({ error: 'Name, email, and role are required' });
        }

        if (!['manager', 'team_member'].includes(role)) {
            return res.status(400).json({ error: 'Role must be manager or team_member' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);

        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, team_id) VALUES (?, ?, ?, ?, ?)
        `).run(name, email, passwordHash, role, team_id);

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('Create user error:', error);
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user (manager only)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, email, role, team_id, password } = req.body;

        if (password) {
            const passwordHash = bcrypt.hashSync(password, 10);
            db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?, team_id = ?, password_hash = ?
                WHERE id = ?
            `).run(name, email, role, team_id, passwordHash, req.params.id);
        } else {
            db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?, team_id = ?
                WHERE id = ?
            `).run(name, email, role, team_id, req.params.id);
        }

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete user (manager only)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        // Prevent self-deletion
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router;
