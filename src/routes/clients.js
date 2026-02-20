const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all clients (filtered by user assignment for team members, managers, AND associate partners)
router.get('/', authenticateToken, (req, res) => {
    try {
        let clients;
        const { manager_id } = req.query; // Optional filter by manager (admin only)

        if (req.user.role === 'admin') {
            if (manager_id) {
                // Admin filtering by specific manager's clients
                clients = db.prepare(`
                    SELECT c.*, 
                        GROUP_CONCAT(DISTINCT u.name) as assigned_users,
                        GROUP_CONCAT(DISTINCT lg.name) as assigned_law_groups
                    FROM clients c
                    INNER JOIN user_client_assignments uca ON c.id = uca.client_id
                    LEFT JOIN users u ON uca.user_id = u.id
                    LEFT JOIN client_law_group_assignments clga ON c.id = clga.client_id
                    LEFT JOIN law_groups lg ON clga.law_group_id = lg.id
                    WHERE c.is_active = 1 AND uca.user_id = ?
                    GROUP BY c.id
                    ORDER BY c.name
                `).all(manager_id);
            } else {
                // Only Admins see all clients with assigned users and law groups
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
            }
        } else {
            // Associate partners, Managers and Team members see only their assigned clients
            clients = db.prepare(`
                SELECT c.*,
                    GROUP_CONCAT(DISTINCT u.name) as assigned_users,
                    GROUP_CONCAT(DISTINCT lg.name) as assigned_law_groups
                FROM clients c
                INNER JOIN user_client_assignments uca ON c.id = uca.client_id
                LEFT JOIN users u ON uca.user_id = u.id
                LEFT JOIN client_law_group_assignments clga ON c.id = clga.client_id
                LEFT JOIN law_groups lg ON clga.law_group_id = lg.id
                WHERE uca.user_id = ? AND c.is_active = 1
                GROUP BY c.id
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

        // Check access for team members, managers, and associate partners
        if (req.user.role !== 'admin') {
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

        // Get excluded compliances (graceful if table doesn't exist)
        try {
            const excludedCompliances = db.prepare(`
                SELECT compliance_id FROM client_excluded_compliances
                WHERE client_id = ?
            `).all(req.params.id);
            client.excluded_compliance_ids = excludedCompliances.map(ec => ec.compliance_id);
        } catch (e) {
            client.excluded_compliance_ids = [];
        }

        res.json(client);
    } catch (error) {
        console.error('Get client error:', error);
        res.status(500).json({ error: 'Failed to get client' });
    }
});

// Create client (manager/admin only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        let { name, industry, notes, channel_mail, email_domain, user_ids, law_group_ids, excluded_compliance_ids } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Client name is required' });
        }

        // Deduplicate arrays to prevent UNIQUE constraint errors
        if (user_ids) user_ids = [...new Set(user_ids)];
        if (law_group_ids) law_group_ids = [...new Set(law_group_ids)];
        if (excluded_compliance_ids) excluded_compliance_ids = [...new Set(excluded_compliance_ids)];

        const result = db.prepare(`
            INSERT INTO clients (name, industry, notes, channel_mail, email_domain) VALUES (?, ?, ?, ?, ?)
        `).run(name, industry || null, notes || null, channel_mail || null, email_domain || null);

        // Assign to users if specified
        // Auto-include the creator so they don't lose access to their own client
        if (!user_ids) user_ids = [];
        if (req.user.role !== 'admin' && !user_ids.includes(req.user.id)) {
            user_ids.push(req.user.id);
        }
        if (user_ids.length > 0) {
            const insertAssignment = db.prepare(`
                INSERT OR IGNORE INTO user_client_assignments (user_id, client_id) VALUES (?, ?)
            `);
            for (const userId of user_ids) {
                insertAssignment.run(userId, result.lastInsertRowid);
            }
        }

        // Assign to law groups if specified
        if (law_group_ids && law_group_ids.length > 0) {
            const insertLawGroupAssignment = db.prepare(`
                INSERT OR IGNORE INTO client_law_group_assignments (client_id, law_group_id) VALUES (?, ?)
            `);
            for (const lawGroupId of law_group_ids) {
                insertLawGroupAssignment.run(result.lastInsertRowid, lawGroupId);
            }
        }

        // Save excluded compliances if specified (graceful if table doesn't exist)
        if (excluded_compliance_ids && excluded_compliance_ids.length > 0) {
            try {
                const insertExcluded = db.prepare(`
                    INSERT OR IGNORE INTO client_excluded_compliances (client_id, compliance_id) VALUES (?, ?)
                `);
                for (const complianceId of excluded_compliance_ids) {
                    insertExcluded.run(result.lastInsertRowid, complianceId);
                }
            } catch (e) {
                // Table may not exist yet, ignore
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
        let { name, industry, notes, channel_mail, email_domain, is_active, user_ids, law_group_ids, excluded_compliance_ids } = req.body;

        // Deduplicate arrays to prevent UNIQUE constraint errors
        if (user_ids) user_ids = [...new Set(user_ids)];
        if (law_group_ids) law_group_ids = [...new Set(law_group_ids)];
        if (excluded_compliance_ids) excluded_compliance_ids = [...new Set(excluded_compliance_ids)];

        db.prepare(`
            UPDATE clients SET name = ?, industry = ?, notes = ?, channel_mail = ?, email_domain = ?, is_active = ?
            WHERE id = ?
        `).run(name, industry || null, notes || null, channel_mail || null, email_domain || null, is_active ?? 1, req.params.id);

        // Update user assignments if provided
        if (user_ids !== undefined) {
            db.prepare('DELETE FROM user_client_assignments WHERE client_id = ?').run(req.params.id);

            const insertAssignment = db.prepare(`
                INSERT OR IGNORE INTO user_client_assignments (user_id, client_id) VALUES (?, ?)
            `);
            for (const userId of user_ids) {
                insertAssignment.run(userId, req.params.id);
            }
        }

        // Update law group assignments if provided
        if (law_group_ids !== undefined) {
            db.prepare('DELETE FROM client_law_group_assignments WHERE client_id = ?').run(req.params.id);

            const insertLawGroupAssignment = db.prepare(`
                INSERT OR IGNORE INTO client_law_group_assignments (client_id, law_group_id) VALUES (?, ?)
            `);
            for (const lawGroupId of law_group_ids) {
                insertLawGroupAssignment.run(req.params.id, lawGroupId);
            }
        }

        // Update excluded compliances if provided (graceful if table doesn't exist)
        if (excluded_compliance_ids !== undefined) {
            try {
                db.prepare('DELETE FROM client_excluded_compliances WHERE client_id = ?').run(req.params.id);

                const insertExcluded = db.prepare(`
                    INSERT OR IGNORE INTO client_excluded_compliances (client_id, compliance_id) VALUES (?, ?)
                `);
                for (const complianceId of excluded_compliance_ids) {
                    insertExcluded.run(req.params.id, complianceId);
                }
            } catch (e) {
                // Table may not exist yet, ignore
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

