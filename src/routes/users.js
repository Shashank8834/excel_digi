const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin/manager only)
router.get('/', authenticateToken, requireManager, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT u.id, u.name, u.email, u.role, u.created_at
            FROM users u
            ORDER BY u.name
        `).all();

        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Create user (admin and manager)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, email, role } = req.body;
        // Default password is 'password123' if not provided
        const password = req.body.password || 'password123';

        if (!name || !email || !role) {
            return res.status(400).json({ error: 'Name, email, and role are required' });
        }

        if (!['admin', 'manager', 'team_member'].includes(role)) {
            return res.status(400).json({ error: 'Role must be admin, manager, or team_member' });
        }

        // Managers cannot create admin users
        if (req.user.role === 'manager' && role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot create admin users' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);

        // New users must change password on first login
        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)
        `).run(name, email, passwordHash, role);

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

// Update user (admin and manager with restrictions)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, email, role, password } = req.body;
        const targetUserId = parseInt(req.params.id);

        if (!['admin', 'manager', 'team_member'].includes(role)) {
            return res.status(400).json({ error: 'Role must be admin, manager, or team_member' });
        }

        // Get the target user to check their role
        const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(targetUserId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Managers cannot edit admin users
        if (req.user.role === 'manager' && targetUser.role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot edit admin users' });
        }

        // Managers cannot promote users to admin
        if (req.user.role === 'manager' && role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot promote users to admin' });
        }

        if (password) {
            const passwordHash = bcrypt.hashSync(password, 10);
            db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?, password_hash = ?
                WHERE id = ?
            `).run(name, email, role, passwordHash, targetUserId);
        } else {
            db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?
                WHERE id = ?
            `).run(name, email, role, targetUserId);
        }

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete user (admin and manager with restrictions)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const targetUserId = parseInt(req.params.id);

        // Prevent self-deletion
        if (targetUserId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        // Get the target user to check their role
        const targetUser = db.prepare('SELECT role FROM users WHERE id = ?').get(targetUserId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Managers cannot delete admin users
        if (req.user.role === 'manager' && targetUser.role === 'admin') {
            return res.status(403).json({ error: 'Managers cannot delete admin users' });
        }

        // Also remove user-client assignments
        db.prepare('DELETE FROM user_client_assignments WHERE user_id = ?').run(targetUserId);
        db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router;
