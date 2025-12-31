const express = require('express');
const { db } = require('../db/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get compliance matrix (clients as rows, compliances as columns)
router.get('/matrix', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Get clients based on monthly inclusion and user role
        let clients;
        if (req.user.role === 'manager') {
            // Managers see clients included for this month, or all if none set yet
            clients = db.prepare(`
                SELECT c.id, c.name, c.industry, mci.team_id
                FROM clients c
                LEFT JOIN monthly_client_inclusion mci 
                    ON c.id = mci.client_id 
                    AND mci.period_year = ? 
                    AND mci.period_month = ?
                WHERE c.is_active = 1 
                    AND (mci.is_included = 1 OR mci.is_included IS NULL)
                ORDER BY c.name
            `).all(periodYear, periodMonth);
        } else {
            // Team members see only clients assigned to their team for this month
            clients = db.prepare(`
                SELECT c.id, c.name, c.industry
                FROM clients c
                INNER JOIN monthly_client_inclusion mci 
                    ON c.id = mci.client_id 
                    AND mci.period_year = ? 
                    AND mci.period_month = ?
                WHERE mci.team_id = ? 
                    AND mci.is_included = 1 
                    AND c.is_active = 1
                ORDER BY c.name
            `).all(periodYear, periodMonth, req.user.team_id);
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
        if (req.user.role !== 'manager') {
            const hasAccess = db.prepare(`
                SELECT 1 FROM team_client_assignments 
                WHERE team_id = ? AND client_id = ?
            `).get(req.user.team_id, client_id);

            if (!hasAccess) {
                return res.status(403).json({ error: 'You do not have access to this client' });
            }
        }

        // Check if period is editable (only current month or future)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        if (periodYear < currentYear || (periodYear === currentYear && periodMonth < currentMonth)) {
            return res.status(403).json({ error: 'Cannot edit past months' });
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

        if (req.user.role !== 'manager') {
            clientFilter = `
                AND c.id IN (
                    SELECT client_id FROM team_client_assignments WHERE team_id = ?
                )
            `;
            params.push(req.user.team_id);
        }

        const pendingItems = db.prepare(`
            SELECT 
                c.id as client_id, 
                c.name as client_name,
                comp.id as compliance_id,
                comp.name as compliance_name,
                comp.deadline_day,
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

        if (req.user.role !== 'manager') {
            clientFilter = `WHERE c.id IN (SELECT client_id FROM team_client_assignments WHERE team_id = ?)`;
            params.push(req.user.team_id);
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

// Get monthly client inclusions
router.get('/monthly-clients', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Get all clients with their inclusion status for this month
        const clients = db.prepare(`
            SELECT 
                c.id, c.name, c.industry,
                mci.is_included,
                mci.team_id,
                t.name as team_name
            FROM clients c
            LEFT JOIN monthly_client_inclusion mci 
                ON c.id = mci.client_id 
                AND mci.period_year = ? 
                AND mci.period_month = ?
            LEFT JOIN teams t ON mci.team_id = t.id
            WHERE c.is_active = 1
            ORDER BY c.name
        `).all(periodYear, periodMonth);

        // Get all teams for dropdown
        const teams = db.prepare('SELECT id, name FROM teams ORDER BY name').all();

        res.json({ clients, teams, period: { year: periodYear, month: periodMonth } });
    } catch (error) {
        console.error('Get monthly clients error:', error);
        res.status(500).json({ error: 'Failed to get monthly clients' });
    }
});

// Update monthly client inclusion
router.post('/monthly-clients', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Only managers can update monthly client assignments' });
        }

        const { client_id, year, month, is_included, team_id } = req.body;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Delete existing and insert new
        db.prepare(`
            DELETE FROM monthly_client_inclusion 
            WHERE client_id = ? AND period_year = ? AND period_month = ?
        `).run(client_id, periodYear, periodMonth);

        db.prepare(`
            INSERT INTO monthly_client_inclusion (client_id, team_id, period_year, period_month, is_included)
            VALUES (?, ?, ?, ?, ?)
        `).run(client_id, team_id || null, periodYear, periodMonth, is_included ? 1 : 0);

        res.json({ message: 'Client updated for this month' });
    } catch (error) {
        console.error('Update monthly client error:', error);
        res.status(500).json({ error: 'Failed to update monthly client' });
    }
});

// Get monthly compliance deadlines
router.get('/monthly-deadlines', authenticateToken, (req, res) => {
    try {
        const { year, month } = req.query;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        const compliances = db.prepare(`
            SELECT 
                c.id, c.name, c.deadline_day as default_deadline,
                lg.name as law_group_name,
                mco.custom_deadline_day
            FROM compliances c
            INNER JOIN law_groups lg ON c.law_group_id = lg.id
            LEFT JOIN monthly_compliance_overrides mco 
                ON c.id = mco.compliance_id 
                AND mco.period_year = ? 
                AND mco.period_month = ?
            WHERE c.is_active = 1
            ORDER BY lg.display_order, c.display_order
        `).all(periodYear, periodMonth);

        res.json({ compliances, period: { year: periodYear, month: periodMonth } });
    } catch (error) {
        console.error('Get monthly deadlines error:', error);
        res.status(500).json({ error: 'Failed to get monthly deadlines' });
    }
});

// Update monthly compliance deadline
router.post('/monthly-deadlines', authenticateToken, (req, res) => {
    try {
        if (req.user.role !== 'manager') {
            return res.status(403).json({ error: 'Only managers can update deadlines' });
        }

        const { compliance_id, year, month, custom_deadline_day } = req.body;
        const periodYear = parseInt(year) || new Date().getFullYear();
        const periodMonth = parseInt(month) || new Date().getMonth() + 1;

        // Delete existing and insert new
        db.prepare(`
            DELETE FROM monthly_compliance_overrides 
            WHERE compliance_id = ? AND period_year = ? AND period_month = ?
        `).run(compliance_id, periodYear, periodMonth);

        if (custom_deadline_day) {
            db.prepare(`
                INSERT INTO monthly_compliance_overrides (compliance_id, period_year, period_month, custom_deadline_day)
                VALUES (?, ?, ?, ?)
            `).run(compliance_id, periodYear, periodMonth, parseInt(custom_deadline_day));
        }

        res.json({ message: 'Deadline updated' });
    } catch (error) {
        console.error('Update deadline error:', error);
        res.status(500).json({ error: 'Failed to update deadline' });
    }
});

module.exports = router;
