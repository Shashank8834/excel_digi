const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get compliance matrix (clients as rows, compliances as columns)
router.get('/matrix', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Get clients based on user role
        let clients;
        if (req.user.role === 'admin' || req.user.role === 'manager') {
            // Admins/Managers see all active clients
            clients = db.prepare(`
                SELECT c.id, c.name, c.industry
                FROM clients c
                WHERE c.is_active = 1
                ORDER BY c.name
            `).all();
        } else {
            // Team members see only clients assigned to them
            clients = db.prepare(`
                SELECT c.id, c.name, c.industry
                FROM clients c
                INNER JOIN user_client_assignments uca ON c.id = uca.client_id
                WHERE uca.user_id = ? AND c.is_active = 1
                ORDER BY c.name
            `).all(req.user.id);
        }

        // Get all active compliances grouped by law group
        const lawGroups = db.prepare(`
            SELECT * FROM law_groups ORDER BY display_order, name
        `).all();

        const getCompliances = db.prepare(`
            SELECT * FROM compliances 
            WHERE law_group_id = ? AND is_active = 1
            ORDER BY display_order, name
        `);

        const lawGroupsWithCompliances = lawGroups.map(lg => ({
            ...lg,
            compliances: getCompliances.all(lg.id)
        }));

        // Get all status entries for this period
        const statusEntries = db.prepare(`
            SELECT client_id, compliance_id, status, notes
            FROM client_compliance_status
            WHERE period_year = ? AND period_month = ?
        `).all(periodYear, periodMonth);

        // Create a lookup map for statuses
        const statusMap = {};
        statusEntries.forEach(entry => {
            statusMap[`${entry.client_id}-${entry.compliance_id}`] = entry;
        });

        // Build the matrix data
        const matrix = clients.map(client => {
            const row = {
                client,
                statuses: {}
            };

            lawGroupsWithCompliances.forEach(lg => {
                lg.compliances.forEach(comp => {
                    const key = `${client.id}-${comp.id}`;
                    const statusEntry = statusMap[key];
                    row.statuses[comp.id] = statusEntry ? {
                        status: statusEntry.status,
                        notes: statusEntry.notes
                    } : {
                        status: 'pending',
                        notes: null
                    };
                });
            });

            return row;
        });

        res.json({
            period: { year: periodYear, month: periodMonth },
            lawGroups: lawGroupsWithCompliances,
            matrix
        });
    } catch (error) {
        console.error('Get matrix error:', error);
        res.status(500).json({ error: 'Failed to get compliance matrix' });
    }
});

// Update status for a client-compliance pair
router.post('/update', authenticateToken, (req, res) => {
    try {
        const { client_id, compliance_id, year, month, status } = req.body;
        const notes = req.body.notes || null;

        if (!client_id || !compliance_id || !status) {
            return res.status(400).json({ error: 'Client ID, compliance ID, and status are required' });
        }

        if (!['done', 'pending', 'na'].includes(status)) {
            return res.status(400).json({ error: 'Status must be done, pending, or na' });
        }

        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Check if team member has access to this client
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            const hasAccess = db.prepare(`
                SELECT 1 FROM user_client_assignments 
                WHERE user_id = ? AND client_id = ?
            `).get(req.user.id, client_id);

            if (!hasAccess) {
                return res.status(403).json({ error: 'You do not have access to this client' });
            }
        }

        // Check if period is editable (only current month or future) - only admin can edit all
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        if (req.user.role !== 'admin') {
            if (periodYear < currentYear || (periodYear === currentYear && periodMonth < currentMonth)) {
                return res.status(403).json({ error: 'Cannot edit past months' });
            }
        }

        // First delete any existing entry
        db.prepare(`
            DELETE FROM client_compliance_status 
            WHERE client_id = ? AND compliance_id = ? AND period_year = ? AND period_month = ?
        `).run(client_id, compliance_id, periodYear, periodMonth);

        // Then insert the new status
        db.prepare(`
            INSERT INTO client_compliance_status (client_id, compliance_id, period_year, period_month, status, notes, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(client_id, compliance_id, periodYear, periodMonth, status, notes, req.user.id);

        res.json({ message: 'Status updated successfully' });
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Failed to update status: ' + error.message });
    }
});

// Get deadline warnings for current period
router.get('/deadlines', authenticateToken, (req, res) => {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const currentDay = now.getDate();

        // Get all pending compliances for this month with their deadlines
        let clientFilter = '';
        const params = [currentYear, currentMonth];

        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            clientFilter = `
                AND c.id IN (
                    SELECT client_id FROM user_client_assignments WHERE user_id = ?
                )
            `;
            params.push(req.user.id);
        }

        const pendingItems = db.prepare(`
            SELECT 
                c.id as client_id, 
                c.name as client_name,
                comp.id as compliance_id,
                comp.name as compliance_name,
                COALESCE(dce.extension_day, mco.custom_deadline_day, comp.deadline_day) as deadline_day,
                lg.name as law_group_name,
                COALESCE(ccs.status, 'pending') as status
            FROM clients c
            CROSS JOIN compliances comp
            INNER JOIN law_groups lg ON comp.law_group_id = lg.id
            LEFT JOIN client_compliance_status ccs 
                ON c.id = ccs.client_id 
                AND comp.id = ccs.compliance_id
                AND ccs.period_year = ?
                AND ccs.period_month = ?
            LEFT JOIN default_compliance_extensions dce ON comp.id = dce.compliance_id
            LEFT JOIN monthly_compliance_overrides mco 
                ON comp.id = mco.compliance_id 
                AND mco.period_year = ${currentYear}
                AND mco.period_month = ${currentMonth}
            WHERE c.is_active = 1 
                AND comp.is_active = 1
                AND (comp.frequency = 'monthly' OR (comp.frequency = 'yearly' AND comp.deadline_month = ${currentMonth}))
                AND COALESCE(ccs.status, 'pending') = 'pending'
                ${clientFilter}
        `).all(...params);

        // Calculate deadline status
        const result = pendingItems.map(item => {
            const daysUntilDeadline = item.deadline_day - currentDay;
            let urgency = 'normal';

            if (daysUntilDeadline < 0) {
                urgency = 'overdue';
            } else if (daysUntilDeadline === 0) {
                urgency = 'today';
            } else if (daysUntilDeadline <= 2) {
                urgency = 'warning';
            } else if (daysUntilDeadline <= 7) {
                urgency = 'upcoming';
            }

            return {
                ...item,
                days_until_deadline: daysUntilDeadline,
                urgency
            };
        });

        // Sort by urgency (most urgent first)
        const urgencyOrder = { overdue: 0, today: 1, warning: 2, upcoming: 3, normal: 4 };
        result.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

        res.json(result);
    } catch (error) {
        console.error('Get deadlines error:', error);
        res.status(500).json({ error: 'Failed to get deadline warnings' });
    }
});

// Get summary statistics
router.get('/summary', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        let clientFilter = '';
        const params = [periodYear, periodMonth];

        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            clientFilter = `WHERE c.id IN (SELECT client_id FROM user_client_assignments WHERE user_id = ?)`;
            params.push(req.user.id);
        }

        // Get total counts
        const stats = db.prepare(`
            SELECT 
                COUNT(DISTINCT c.id) as total_clients,
                COUNT(DISTINCT comp.id) as total_compliances,
                SUM(CASE WHEN ccs.status = 'done' THEN 1 ELSE 0 END) as done_count,
                SUM(CASE WHEN ccs.status = 'pending' OR ccs.status IS NULL THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN ccs.status = 'na' THEN 1 ELSE 0 END) as na_count
            FROM clients c
            CROSS JOIN compliances comp
            LEFT JOIN client_compliance_status ccs 
                ON c.id = ccs.client_id 
                AND comp.id = ccs.compliance_id
                AND ccs.period_year = ?
                AND ccs.period_month = ?
            ${clientFilter}
            AND c.is_active = 1 AND comp.is_active = 1
        `).get(...params);

        res.json({
            period: { year: periodYear, month: periodMonth },
            ...stats
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({ error: 'Failed to get summary' });
    }
});

// Get compliance extensions (admin only)
router.get('/extensions', authenticateToken, requireAdmin, (req, res) => {
    try {
        const compliances = db.prepare(`
            SELECT 
                c.id, c.name, c.deadline_day as default_deadline,
                lg.name as law_group_name,
                dce.extension_day
            FROM compliances c
            INNER JOIN law_groups lg ON c.law_group_id = lg.id
            LEFT JOIN default_compliance_extensions dce ON c.id = dce.compliance_id
            WHERE c.is_active = 1
            ORDER BY lg.display_order, c.display_order
        `).all();

        res.json({ compliances });
    } catch (error) {
        console.error('Get extensions error:', error);
        res.status(500).json({ error: 'Failed to get extensions' });
    }
});

// Update compliance extension (admin only) - persists as default
router.post('/extensions', authenticateToken, requireAdmin, (req, res) => {
    try {
        const { compliance_id, extension_day } = req.body;

        // Delete existing extension
        db.prepare(`
            DELETE FROM default_compliance_extensions WHERE compliance_id = ?
        `).run(compliance_id);

        // Insert new extension if provided
        if (extension_day) {
            db.prepare(`
                INSERT INTO default_compliance_extensions (compliance_id, extension_day)
                VALUES (?, ?)
            `).run(compliance_id, parseInt(extension_day));
        }

        res.json({ message: 'Extension updated and will apply to all future months' });
    } catch (error) {
        console.error('Update extension error:', error);
        res.status(500).json({ error: 'Failed to update extension' });
    }
});

// Calendar data - get all tasks for a month with deadlines
router.get('/calendar', authenticateToken, (req, res) => {
    try {
        const { year, month, client_id } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        let clientFilter = '';
        const params = [periodYear, periodMonth, periodYear, periodMonth];

        // Filter by specific client if provided
        if (client_id) {
            clientFilter = 'AND c.id = ?';
            params.push(parseInt(client_id));
        } else if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            // Team members can only see assigned clients
            clientFilter = 'AND c.id IN (SELECT client_id FROM user_client_assignments WHERE user_id = ?)';
            params.push(req.user.id);
        }

        const tasks = db.prepare(`
            SELECT 
                c.id as client_id, 
                c.name as client_name,
                comp.id as compliance_id,
                comp.name as compliance_name,
                COALESCE(dce.extension_day, mco.custom_deadline_day, comp.deadline_day) as deadline_day,
                lg.name as law_group_name,
                COALESCE(ccs.status, 'pending') as status
            FROM clients c
            CROSS JOIN compliances comp
            INNER JOIN law_groups lg ON comp.law_group_id = lg.id
            LEFT JOIN client_compliance_status ccs 
                ON c.id = ccs.client_id 
                AND comp.id = ccs.compliance_id
                AND ccs.period_year = ?
                AND ccs.period_month = ?
            LEFT JOIN default_compliance_extensions dce ON comp.id = dce.compliance_id
            LEFT JOIN monthly_compliance_overrides mco 
                ON comp.id = mco.compliance_id 
                AND mco.period_year = ?
                AND mco.period_month = ?
            WHERE c.is_active = 1 
                AND comp.is_active = 1
                AND (comp.frequency = 'monthly' OR (comp.frequency = 'yearly' AND comp.deadline_month = ${periodMonth}))
                ${clientFilter}
            ORDER BY COALESCE(dce.extension_day, mco.custom_deadline_day, comp.deadline_day), c.name
        `).all(...params);

        // Group by deadline day
        const tasksByDay = {};
        tasks.forEach(task => {
            const day = task.deadline_day || 1;
            if (!tasksByDay[day]) {
                tasksByDay[day] = [];
            }
            tasksByDay[day].push(task);
        });

        res.json({
            period: { year: periodYear, month: periodMonth },
            tasksByDay
        });
    } catch (error) {
        console.error('Get calendar error:', error);
        res.status(500).json({ error: 'Failed to get calendar data' });
    }
});

module.exports = router;

