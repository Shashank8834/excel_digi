const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all teams
router.get('/', authenticateToken, (req, res) => {
    try {
        const teams = db.prepare(`
            SELECT t.*, 
                   COUNT(DISTINCT u.id) as member_count,
                   COUNT(DISTINCT tca.client_id) as client_count
            FROM teams t
            LEFT JOIN users u ON t.id = u.team_id
            LEFT JOIN team_client_assignments tca ON t.id = tca.team_id
            GROUP BY t.id
            ORDER BY t.name
        `).all();

        res.json(teams);
    } catch (error) {
        console.error('Get teams error:', error);
        res.status(500).json({ error: 'Failed to get teams' });
    }
});

// Get single team with members
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);

        if (!team) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const members = db.prepare(`
            SELECT id, name, email, role FROM users WHERE team_id = ?
        `).all(req.params.id);

        const clients = db.prepare(`
            SELECT c.id, c.name, c.industry
            FROM clients c
            INNER JOIN team_client_assignments tca ON c.id = tca.client_id
            WHERE tca.team_id = ?
            ORDER BY c.name
        `).all(req.params.id);

        res.json({ ...team, members, clients });
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({ error: 'Failed to get team' });
    }
});

// Create team (manager only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Team name is required' });
        }

        const result = db.prepare(`
            INSERT INTO teams (name, created_by) VALUES (?, ?)
        `).run(name, req.user.id);

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Team created successfully'
        });
    } catch (error) {
        console.error('Create team error:', error);
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Team with this name already exists' });
        }
        res.status(500).json({ error: 'Failed to create team' });
    }
});

// Update team (manager only)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { name } = req.body;

        db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, req.params.id);
        res.json({ message: 'Team updated successfully' });
    } catch (error) {
        console.error('Update team error:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

// Delete team (manager only)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        // Check if team has members
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE team_id = ?').get(req.params.id);

        if (memberCount.count > 0) {
            return res.status(400).json({ error: 'Cannot delete team with members. Reassign members first.' });
        }

        db.prepare('DELETE FROM team_client_assignments WHERE team_id = ?').run(req.params.id);
        db.prepare('DELETE FROM teams WHERE id = ?').run(req.params.id);
        res.json({ message: 'Team deleted successfully' });
    } catch (error) {
        console.error('Delete team error:', error);
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// Assign client to team (manager only)
router.post('/:id/clients', authenticateToken, requireManager, (req, res) => {
    try {
        const { client_id } = req.body;

        db.prepare(`
            INSERT OR IGNORE INTO team_client_assignments (team_id, client_id) VALUES (?, ?)
        `).run(req.params.id, client_id);

        res.json({ message: 'Client assigned to team successfully' });
    } catch (error) {
        console.error('Assign client error:', error);
        res.status(500).json({ error: 'Failed to assign client to team' });
    }
});

// Remove client from team (manager only)
router.delete('/:id/clients/:clientId', authenticateToken, requireManager, (req, res) => {
    try {
        db.prepare(`
            DELETE FROM team_client_assignments WHERE team_id = ? AND client_id = ?
        `).run(req.params.id, req.params.clientId);

        res.json({ message: 'Client removed from team successfully' });
    } catch (error) {
        console.error('Remove client error:', error);
        res.status(500).json({ error: 'Failed to remove client from team' });
    }
});

module.exports = router;
