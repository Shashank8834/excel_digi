const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all clients (filtered by user assignment for team members)
router.get('/', authenticateToken, (req, res) => {
    try {
        let clients;

        if (req.user.role === 'admin' || req.user.role === 'manager') {
            // Admins/Managers see all clients with assigned users and law groups
            clients = db.prepare(`
                SELECT c.*, 
                    GROUP_CONCAT(DISTINCT u.name) as assigned_users,
                    GROUP_CONCAT(DISTINCT lg.name) as assigned_law_groups
                FROM clients c
                LEFT JOIN user_client_assignments uca ON c.id = uca.client_id
                LEFT JOIN users u ON uca.user_id = u.id
                LEFT JOIN client_law_group_assignments clga ON c.id = clga.client_id
                LEFT JOIN law_groups lg ON clga.law_group_id = lg.id
                WHERE c.is_active = 1
                GROUP BY c.id
                ORDER BY c.name
            `).all();
        } else {
            // Team members see only their assigned clients
            clients = db.prepare(`
                SELECT c.*
                FROM clients c
                INNER JOIN user_client_assignments uca ON c.id = uca.client_id
                WHERE uca.user_id = ? AND c.is_active = 1
                ORDER BY c.name
            `).all(req.user.id);
        }

        res.json(clients);
    } catch (error) {
        console.error('Get clients error:', error);
        res.status(500).json({ error: 'Failed to get clients' });
    }
});

// Get single client
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Check access for team members
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            const hasAccess = db.prepare(`
                SELECT 1 FROM user_client_assignments 
                WHERE user_id = ? AND client_id = ?
            `).get(req.user.id, req.params.id);

            if (!hasAccess) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        // Get assigned users
        const users = db.prepare(`
            SELECT u.id FROM users u
            INNER JOIN user_client_assignments uca ON u.id = uca.user_id
            WHERE uca.client_id = ?
        `).all(req.params.id);
        client.user_ids = users.map(u => u.id);

        // Get assigned law groups
        const lawGroups = db.prepare(`
            SELECT lg.id FROM law_groups lg
            INNER JOIN client_law_group_assignments clga ON lg.id = clga.law_group_id
            WHERE clga.client_id = ?
        `).all(req.params.id);
        client.law_group_ids = lawGroups.map(lg => lg.id);

        res.json(client);
    } catch (error) {
        console.error('Get client error:', error);
        res.status(500).json({ error: 'Failed to get client' });
    }
});

// Create client (manager/admin only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, industry, notes, channel_mail, user_ids, law_group_ids } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Client name is required' });
        }

        const result = db.prepare(`
            INSERT INTO clients (name, industry, notes, channel_mail) VALUES (?, ?, ?, ?)
        `).run(name, industry, notes, channel_mail || null);

        // Assign to users if specified
        if (user_ids && user_ids.length > 0) {
            const insertAssignment = db.prepare(`
                INSERT INTO user_client_assignments (user_id, client_id) VALUES (?, ?)
            `);
            for (const userId of user_ids) {
                insertAssignment.run(userId, result.lastInsertRowid);
            }
        }

        // Assign to law groups if specified
        if (law_group_ids && law_group_ids.length > 0) {
            const insertLawGroupAssignment = db.prepare(`
                INSERT INTO client_law_group_assignments (client_id, law_group_id) VALUES (?, ?)
            `);
            for (const lawGroupId of law_group_ids) {
                insertLawGroupAssignment.run(result.lastInsertRowid, lawGroupId);
            }
        }

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Client created successfully'
        });
    } catch (error) {
        console.error('Create client error:', error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// Update client (manager/admin only)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, industry, notes, channel_mail, is_active, user_ids, law_group_ids } = req.body;

        db.prepare(`
            UPDATE clients SET name = ?, industry = ?, notes = ?, channel_mail = ?, is_active = ?
            WHERE id = ?
        `).run(name, industry, notes, channel_mail || null, is_active ?? 1, req.params.id);

        // Update user assignments if provided
        if (user_ids !== undefined) {
            db.prepare('DELETE FROM user_client_assignments WHERE client_id = ?').run(req.params.id);

            const insertAssignment = db.prepare(`
                INSERT INTO user_client_assignments (user_id, client_id) VALUES (?, ?)
            `);
            for (const userId of user_ids) {
                insertAssignment.run(userId, req.params.id);
            }
        }

        // Update law group assignments if provided
        if (law_group_ids !== undefined) {
            db.prepare('DELETE FROM client_law_group_assignments WHERE client_id = ?').run(req.params.id);

            const insertLawGroupAssignment = db.prepare(`
                INSERT INTO client_law_group_assignments (client_id, law_group_id) VALUES (?, ?)
            `);
            for (const lawGroupId of law_group_ids) {
                insertLawGroupAssignment.run(req.params.id, lawGroupId);
            }
        }

        res.json({ message: 'Client updated successfully' });
    } catch (error) {
        console.error('Update client error:', error);
        res.status(500).json({ error: 'Failed to update client' });
    }
});

// Delete client (manager/admin only - soft delete)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        db.prepare('UPDATE clients SET is_active = 0 WHERE id = ?').run(req.params.id);
        res.json({ message: 'Client deactivated successfully' });
    } catch (error) {
        console.error('Delete client error:', error);
        res.status(500).json({ error: 'Failed to delete client' });
    }
});

module.exports = router;

