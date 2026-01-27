const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all compliances (optionally filtered by law group)
router.get('/', authenticateToken, (req, res) => {
    try {
        const { lawGroupId } = req.query;

        let query = `
            SELECT c.*, lg.name as law_group_name
            FROM compliances c
            INNER JOIN law_groups lg ON c.law_group_id = lg.id
            WHERE c.is_active = 1
        `;

        const params = [];
        if (lawGroupId) {
            query += ' AND c.law_group_id = ?';
            params.push(lawGroupId);
        }

        query += ' ORDER BY lg.display_order, c.display_order, c.name';

        const compliances = db.prepare(query).all(...params);
        res.json(compliances);
    } catch (error) {
        console.error('Get compliances error:', error);
        res.status(500).json({ error: 'Failed to get compliances' });
    }
});

// Get single compliance
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const compliance = db.prepare(`
            SELECT c.*, lg.name as law_group_name
            FROM compliances c
            INNER JOIN law_groups lg ON c.law_group_id = lg.id
            WHERE c.id = ?
        `).get(req.params.id);

        if (!compliance) {
            return res.status(404).json({ error: 'Compliance not found' });
        }

        res.json(compliance);
    } catch (error) {
        console.error('Get compliance error:', error);
        res.status(500).json({ error: 'Failed to get compliance' });
    }
});

// Create compliance (manager can only create temp, admin/associate_partner can create any)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { law_group_id, name, description, deadline_day, deadline_month, frequency, display_order, manager_only, instruction_video_url, instruction_text, is_temporary, temp_month, temp_year, applicable_client_ids } = req.body;

        if (!name || !frequency) {
            return res.status(400).json({ error: 'Name and frequency are required' });
        }

        if (!['monthly', 'quarterly', 'half_yearly', 'yearly'].includes(frequency)) {
            return res.status(400).json({ error: 'Frequency must be monthly, quarterly, half_yearly, or yearly' });
        }

        // Managers can only create temporary compliances
        if (req.user.role === 'manager') {
            if (!is_temporary) {
                return res.status(403).json({ error: 'Managers can only create temporary compliances' });
            }

            // Check if manager has access to any client with this law group
            if (law_group_id) {
                const hasAccess = db.prepare(`
                    SELECT 1 FROM user_client_assignments uca
                    JOIN client_law_group_assignments clga ON uca.client_id = clga.client_id
                    WHERE uca.user_id = ? AND clga.law_group_id = ?
                `).get(req.user.id, law_group_id);

                if (!hasAccess) {
                    return res.status(403).json({ error: 'You do not have access to this law group' });
                }
            }
        }

        const result = db.prepare(`
            INSERT INTO compliances (law_group_id, name, description, deadline_day, deadline_month, frequency, display_order, manager_only, instruction_video_url, instruction_text, is_temporary, temp_month, temp_year, applicable_client_ids)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(law_group_id || null, name, description || null, deadline_day || null, deadline_month || null, frequency, display_order || 0, manager_only ? 1 : 0, instruction_video_url || null, instruction_text || null, is_temporary ? 1 : 0, temp_month || null, temp_year || null, applicable_client_ids ? JSON.stringify(applicable_client_ids) : null);

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Compliance created successfully'
        });
    } catch (error) {
        console.error('Create compliance error:', error);
        res.status(500).json({ error: 'Failed to create compliance' });
    }
});


// Update compliance (manager can only update temp, admin/associate_partner can update any)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { law_group_id, name, description, deadline_day, deadline_month, frequency, display_order, is_active, manager_only, instruction_video_url, instruction_text } = req.body;

        // Check if manager is trying to edit a non-temp compliance
        if (req.user.role === 'manager') {
            const compliance = db.prepare('SELECT is_temporary, law_group_id FROM compliances WHERE id = ?').get(req.params.id);

            if (!compliance) {
                return res.status(404).json({ error: 'Compliance not found' });
            }

            if (!compliance.is_temporary) {
                return res.status(403).json({ error: 'Managers can only edit temporary compliances' });
            }

            // Check if manager has access to this law group
            if (compliance.law_group_id) {
                const hasAccess = db.prepare(`
                    SELECT 1 FROM user_client_assignments uca
                    JOIN client_law_group_assignments clga ON uca.client_id = clga.client_id
                    WHERE uca.user_id = ? AND clga.law_group_id = ?
                `).get(req.user.id, compliance.law_group_id);

                if (!hasAccess) {
                    return res.status(403).json({ error: 'You do not have access to this compliance' });
                }
            }
        }

        db.prepare(`
            UPDATE compliances 
            SET law_group_id = ?, name = ?, description = ?, deadline_day = ?, 
                deadline_month = ?, frequency = ?, display_order = ?, is_active = ?,
                manager_only = ?, instruction_video_url = ?, instruction_text = ?
            WHERE id = ?
        `).run(law_group_id, name, description || null, deadline_day || null, deadline_month || null, frequency,
            display_order || 0, is_active ?? 1, manager_only ? 1 : 0, instruction_video_url || null, instruction_text || null, req.params.id);

        res.json({ message: 'Compliance updated successfully' });
    } catch (error) {
        console.error('Update compliance error:', error);
        res.status(500).json({ error: 'Failed to update compliance' });
    }
});

// Delete compliance (manager can only delete temp, admin/associate_partner can delete any - soft delete)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        // Check if manager is trying to delete a non-temp compliance
        if (req.user.role === 'manager') {
            const compliance = db.prepare('SELECT is_temporary, law_group_id FROM compliances WHERE id = ?').get(req.params.id);

            if (!compliance) {
                return res.status(404).json({ error: 'Compliance not found' });
            }

            if (!compliance.is_temporary) {
                return res.status(403).json({ error: 'Managers can only delete temporary compliances' });
            }

            // Check if manager has access to this law group
            if (compliance.law_group_id) {
                const hasAccess = db.prepare(`
                    SELECT 1 FROM user_client_assignments uca
                    JOIN client_law_group_assignments clga ON uca.client_id = clga.client_id
                    WHERE uca.user_id = ? AND clga.law_group_id = ?
                `).get(req.user.id, compliance.law_group_id);

                if (!hasAccess) {
                    return res.status(403).json({ error: 'You do not have access to this compliance' });
                }
            }
        }

        db.prepare('UPDATE compliances SET is_active = 0 WHERE id = ?').run(req.params.id);
        res.json({ message: 'Compliance deactivated successfully' });
    } catch (error) {
        console.error('Delete compliance error:', error);
        res.status(500).json({ error: 'Failed to delete compliance' });
    }
});

// Get monthly deadline overrides for a specific month
router.get('/overrides/:year/:month', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.params;
        const overrides = db.prepare(`
            SELECT mco.*, c.name as compliance_name, lg.name as law_group_name
            FROM monthly_compliance_overrides mco
            JOIN compliances c ON mco.compliance_id = c.id
            JOIN law_groups lg ON c.law_group_id = lg.id
            WHERE mco.period_year = ? AND mco.period_month = ?
        `).all(year, month);
        res.json(overrides);
    } catch (error) {
        console.error('Get monthly overrides error:', error);
        res.status(500).json({ error: 'Failed to get monthly overrides' });
    }
});

// Set monthly deadline override for a compliance (manager only)
router.post('/overrides', authenticateToken, requireManager, (req, res) => {
    try {
        const { compliance_id, period_year, period_month, custom_deadline_day } = req.body;

        if (!compliance_id || !period_year || !period_month) {
            return res.status(400).json({ error: 'Compliance ID, year, and month are required' });
        }

        // Use upsert pattern
        db.prepare(`
            INSERT INTO monthly_compliance_overrides (compliance_id, period_year, period_month, custom_deadline_day)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(compliance_id, period_year, period_month) 
            DO UPDATE SET custom_deadline_day = excluded.custom_deadline_day
        `).run(compliance_id, period_year, period_month, custom_deadline_day || null);

        res.json({ message: 'Monthly deadline override saved' });
    } catch (error) {
        console.error('Set monthly override error:', error);
        res.status(500).json({ error: 'Failed to set monthly override' });
    }
});

// Delete monthly deadline override (manager only)
router.delete('/overrides/:complianceId/:year/:month', authenticateToken, requireManager, (req, res) => {
    try {
        const { complianceId, year, month } = req.params;
        db.prepare(`
            DELETE FROM monthly_compliance_overrides 
            WHERE compliance_id = ? AND period_year = ? AND period_month = ?
        `).run(complianceId, year, month);
        res.json({ message: 'Monthly override removed' });
    } catch (error) {
        console.error('Delete monthly override error:', error);
        res.status(500).json({ error: 'Failed to delete monthly override' });
    }
});

module.exports = router;

