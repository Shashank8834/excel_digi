const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Get all law groups with their compliances
router.get('/', authenticateToken, (req, res) => {
    try {
        const lawGroups = db.prepare(`
            SELECT * FROM law_groups ORDER BY display_order, name
        `).all();

        // Get compliances for each law group
        const getCompliances = db.prepare(`
            SELECT * FROM compliances 
            WHERE law_group_id = ? AND is_active = 1
            ORDER BY display_order, name
        `);

        const result = lawGroups.map(lg => ({
            ...lg,
            compliances: getCompliances.all(lg.id)
        }));

        res.json(result);
    } catch (error) {
        console.error('Get law groups error:', error);
        res.status(500).json({ error: 'Failed to get law groups' });
    }
});

// Get single law group with compliances
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const lawGroup = db.prepare('SELECT * FROM law_groups WHERE id = ?').get(req.params.id);

        if (!lawGroup) {
            return res.status(404).json({ error: 'Law group not found' });
        }

        const compliances = db.prepare(`
            SELECT * FROM compliances 
            WHERE law_group_id = ? AND is_active = 1
            ORDER BY display_order, name
        `).all(req.params.id);

        res.json({ ...lawGroup, compliances });
    } catch (error) {
        console.error('Get law group error:', error);
        res.status(500).json({ error: 'Failed to get law group' });
    }
});

// Create law group (manager only)
router.post('/', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, description, display_order, manager_only } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Law group name is required' });
        }

        const result = db.prepare(`
            INSERT INTO law_groups (name, description, display_order, manager_only) VALUES (?, ?, ?, ?)
        `).run(name, description || null, display_order || 0, manager_only ? 1 : 0);

        res.status(201).json({
            id: result.lastInsertRowid,
            message: 'Law group created successfully'
        });
    } catch (error) {
        console.error('Create law group error:', error);
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Law group with this name already exists' });
        }
        res.status(500).json({ error: 'Failed to create law group' });
    }
});


// Update law group (manager only)
router.put('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        const { name, description, display_order, manager_only } = req.body;

        db.prepare(`
            UPDATE law_groups SET name = ?, description = ?, display_order = ?, manager_only = ?
            WHERE id = ?
        `).run(name, description || null, display_order || 0, manager_only ? 1 : 0, req.params.id);

        res.json({ message: 'Law group updated successfully' });
    } catch (error) {
        console.error('Update law group error:', error);
        res.status(500).json({ error: 'Failed to update law group' });
    }
});


// Delete law group (manager only)
router.delete('/:id', authenticateToken, requireManager, (req, res) => {
    try {
        // Check if there are ACTIVE compliances under this law group
        const count = db.prepare(`
            SELECT COUNT(*) as count FROM compliances WHERE law_group_id = ? AND is_active = 1
        `).get(req.params.id);

        if (count.count > 0) {
            return res.status(400).json({
                error: 'Cannot delete law group with existing compliances. Delete compliances first.'
            });
        }

        db.prepare('DELETE FROM law_groups WHERE id = ?').run(req.params.id);
        res.json({ message: 'Law group deleted successfully' });
    } catch (error) {
        console.error('Delete law group error:', error);
        res.status(500).json({ error: 'Failed to delete law group' });
    }
});

module.exports = router;
