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

// Create compliance (manager only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const {
            law_group_id,
            name,
            description,
            default_deadline,
            deadline_day,
            deadline_month,
            frequency = 'monthly',
            display_order,
            manager_only,
            instruction_video_url,
            instruction_text,
            is_temporary,
            temp_year,
            temp_month
        } = req.body;

        if (!law_group_id || !name) {
            return res.status(400).json({ error: 'Law group and name are required' });
        }

        const actualFrequency = frequency || 'monthly';
        if (!['monthly', 'quarterly', 'yearly'].includes(actualFrequency)) {
            return res.status(400).json({ error: 'Frequency must be monthly, quarterly, or yearly' });
        }

        // Use default_deadline or deadline_day
        const deadlineDay = default_deadline || deadline_day;

        const result = db.prepare(`
            INSERT INTO compliances (law_group_id, name, description, deadline_day, deadline_month, frequency, display_order, manager_only, instruction_video_url, instruction_text, is_temporary, temp_year, temp_month)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            law_group_id,
            name,
            description || null,
            deadlineDay || null,
            deadline_month || null,
            actualFrequency,
            display_order || 0,
            manager_only ? 1 : 0,
            instruction_video_url || null,
            instruction_text || null,
            is_temporary ? 1 : 0,
            temp_year || null,
            temp_month || null
        );

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Compliance created successfully'
        });
    } catch (error) {
        console.error('Create compliance error:', error);
        res.status(500).json({ error: 'Failed to create compliance' });
    }
});

// Update compliance (manager only)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { law_group_id, name, description, deadline_day, deadline_month, frequency, display_order, is_active, manager_only, instruction_video_url, instruction_text } = req.body;

        db.prepare(`
            UPDATE compliances 
            SET law_group_id = ?, name = ?, description = ?, deadline_day = ?, 
                deadline_month = ?, frequency = ?, display_order = ?, is_active = ?,
                manager_only = ?, instruction_video_url = ?, instruction_text = ?
            WHERE id = ?
        `).run(law_group_id, name, description, deadline_day, deadline_month, frequency,
            display_order || 0, is_active ?? 1, manager_only ? 1 : 0, instruction_video_url || null, instruction_text || null, req.params.id);

        res.json({ message: 'Compliance updated successfully' });
    } catch (error) {
        console.error('Update compliance error:', error);
        res.status(500).json({ error: 'Failed to update compliance' });
    }
});

// Delete compliance (manager only - soft delete)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        db.prepare('UPDATE compliances SET is_active = 0 WHERE id = ?').run(req.params.id);
        res.json({ message: 'Compliance deactivated successfully' });
    } catch (error) {
        console.error('Delete compliance error:', error);
        res.status(500).json({ error: 'Failed to delete compliance' });
    }
});

module.exports = router;
