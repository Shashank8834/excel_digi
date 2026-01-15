/**
 * Client Insights API Routes
 * Connects compliance tracker with email sentiment analysis data
 * 
 * NOTE: This is an OPTIONAL feature. PostgreSQL connection is not required
 * for the main compliance tracker to work. If pg package is not installed
 * or sentiment DB is unavailable, the app continues to function normally.
 */

const express = require('express');
const { db } = require('../db/database');
const { authenticateToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// Try to load pg package - it's optional
let pgAvailable = false;
let Client = null;
try {
    const pg = require('pg');
    Client = pg.Client;
    pgAvailable = true;
} catch (e) {
    console.log('📊 Insights: pg package not installed - sentiment features disabled (this is optional)');
}

// PostgreSQL connection config for sentiment database
const getSentimentDbConfig = () => ({
    host: process.env.SENTIMENT_DB_HOST || 'localhost',
    port: parseInt(process.env.SENTIMENT_DB_PORT || '5432'),
    database: process.env.SENTIMENT_DB_NAME || 'email_monitor',
    user: process.env.SENTIMENT_DB_USER || 'postgres',
    password: process.env.SENTIMENT_DB_PASSWORD || '',
});

// Helper: Get PostgreSQL connection (returns null if not available)
async function getSentimentDb() {
    if (!pgAvailable || !Client) {
        return null;
    }
    try {
        const client = new Client(getSentimentDbConfig());
        await client.connect();
        return client;
    } catch (error) {
        console.warn('Insights: Could not connect to sentiment database:', error.message);
        return null;
    }
}

// Get all clients with their email domains
router.get('/clients-with-domains', authenticateToken, (req, res) => {
    try {
        const clients = db.prepare(`
            SELECT id, name, email_domain, industry
            FROM clients 
            WHERE is_active = 1
            ORDER BY name
        `).all();

        res.json(clients);
    } catch (error) {
        console.error('Get clients with domains error:', error);
        res.status(500).json({ error: 'Failed to get clients' });
    }
});

// Get sentiment data for a specific client by domain
router.get('/sentiment/:clientId', authenticateToken, async (req, res) => {
    let pgClient = null;
    try {
        // Get client's email domain
        const client = db.prepare('SELECT email_domain FROM clients WHERE id = ?').get(req.params.clientId);

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        if (!client.email_domain) {
            return res.json({
                hasData: false,
                message: 'No email domain configured for this client',
                sentiment: []
            });
        }

        // Query PostgreSQL sentiment database
        pgClient = await getSentimentDb();

        if (!pgClient) {
            return res.json({
                hasData: false,
                message: 'Sentiment database not available',
                sentiment: []
            });
        }

        // Get daily aggregated sentiment data
        const result = await pgClient.query(`
            SELECT 
                DATE(received_dt) as date,
                COUNT(*) as total_emails,
                SUM(CASE WHEN final_label = 'Negative' THEN 1 ELSE 0 END) as negative_count,
                SUM(CASE WHEN final_label = 'Neutral' THEN 1 ELSE 0 END) as neutral_count,
                SUM(CASE WHEN final_label = 'Positive' THEN 1 ELSE 0 END) as positive_count,
                AVG(prob_neg) as avg_negative_prob
            FROM processed
            WHERE sender_domain = $1 OR sender_domain LIKE $2
            GROUP BY DATE(received_dt)
            ORDER BY date DESC
            LIMIT 365
        `, [client.email_domain, `%${client.email_domain}`]);

        res.json({
            hasData: result.rows.length > 0,
            domain: client.email_domain,
            sentiment: result.rows.reverse() // Oldest first for charting
        });

    } catch (error) {
        console.error('Get sentiment data error:', error);
        res.status(500).json({ error: 'Failed to get sentiment data', details: error.message });
    } finally {
        if (pgClient) await pgClient.end();
    }
});

// Get compliance summary for a client
router.get('/compliance/:clientId', authenticateToken, (req, res) => {
    try {
        const clientId = req.params.clientId;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1); // Last 12 months

        // Get monthly compliance status summary
        const monthlyStats = db.prepare(`
            SELECT 
                period_year,
                period_month,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'na' THEN 1 ELSE 0 END) as not_applicable,
                COUNT(*) as total
            FROM client_compliance_status
            WHERE client_id = ?
            GROUP BY period_year, period_month
            ORDER BY period_year, period_month
        `).all(clientId);

        // Get overdue compliances per month
        const overdueStats = db.prepare(`
            SELECT 
                ccs.period_year,
                ccs.period_month,
                COUNT(*) as overdue_count
            FROM client_compliance_status ccs
            JOIN compliances c ON ccs.compliance_id = c.id
            WHERE ccs.client_id = ?
              AND ccs.status = 'pending'
              AND (
                  (c.deadline_day IS NOT NULL AND ccs.period_month < strftime('%m', 'now') AND ccs.period_year <= strftime('%Y', 'now'))
                  OR (ccs.period_year < strftime('%Y', 'now'))
              )
            GROUP BY ccs.period_year, ccs.period_month
        `).all(clientId);

        // Create overdue lookup
        const overdueLookup = {};
        overdueStats.forEach(row => {
            overdueLookup[`${row.period_year}-${row.period_month}`] = row.overdue_count;
        });

        // Merge overdue data
        const compliance = monthlyStats.map(row => ({
            ...row,
            overdue: overdueLookup[`${row.period_year}-${row.period_month}`] || 0,
            completion_rate: (row.total - row.not_applicable) > 0 ? ((row.completed / (row.total - row.not_applicable)) * 100).toFixed(1) : 0
        }));

        // Calculate totals for risk score
        const totalCompliances = monthlyStats.reduce((sum, row) => sum + row.total, 0);
        const totalPending = monthlyStats.reduce((sum, row) => sum + row.pending, 0);
        const totalCompleted = monthlyStats.reduce((sum, row) => sum + row.completed, 0);

        res.json({
            compliance,
            total: totalCompliances,
            pending: totalPending,
            completed: totalCompleted
        });


    } catch (error) {
        console.error('Get compliance data error:', error);
        res.status(500).json({ error: 'Failed to get compliance data' });
    }
});

// Get combined correlation data for a client
router.get('/correlation/:clientId', authenticateToken, async (req, res) => {
    let pgClient = null;
    try {
        const clientId = req.params.clientId;

        // Get client info
        const client = db.prepare('SELECT name, email_domain FROM clients WHERE id = ?').get(clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Get compliance data (monthly)
        const complianceData = db.prepare(`
            SELECT 
                period_year,
                period_month,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                COUNT(*) as total
            FROM client_compliance_status
            WHERE client_id = ?
            GROUP BY period_year, period_month
            ORDER BY period_year, period_month
        `).all(clientId);

        // Build correlation result
        const correlationData = {
            client: client.name,
            domain: client.email_domain,
            months: [],
            hasSentimentData: false
        };

        // If email domain is set, get sentiment data
        if (client.email_domain) {
            try {
                pgClient = await getSentimentDb();

                if (!pgClient) {
                    throw new Error('Sentiment database not available');
                }

                // Get monthly sentiment aggregates
                const sentimentResult = await pgClient.query(`
                    SELECT 
                        EXTRACT(YEAR FROM received_dt)::integer as year,
                        EXTRACT(MONTH FROM received_dt)::integer as month,
                        COUNT(*) as total_emails,
                        SUM(CASE WHEN final_label = 'Negative' THEN 1 ELSE 0 END) as negative_count,
                        AVG(prob_neg) as avg_negative_prob
                    FROM processed
                    WHERE sender_domain = $1 OR sender_domain LIKE $2
                    GROUP BY EXTRACT(YEAR FROM received_dt), EXTRACT(MONTH FROM received_dt)
                    ORDER BY year, month
                `, [client.email_domain, `%${client.email_domain}`]);

                // Build sentiment lookup
                const sentimentLookup = {};
                sentimentResult.rows.forEach(row => {
                    sentimentLookup[`${row.year}-${row.month}`] = {
                        totalEmails: parseInt(row.total_emails),
                        negativeCount: parseInt(row.negative_count),
                        avgNegativeProb: parseFloat(row.avg_negative_prob || 0)
                    };
                });

                correlationData.hasSentimentData = sentimentResult.rows.length > 0;

                // Merge compliance and sentiment data
                complianceData.forEach(comp => {
                    const key = `${comp.period_year}-${comp.period_month}`;
                    const sentiment = sentimentLookup[key] || { totalEmails: 0, negativeCount: 0, avgNegativeProb: 0 };

                    correlationData.months.push({
                        year: comp.period_year,
                        month: comp.period_month,
                        label: `${comp.period_year}-${String(comp.period_month).padStart(2, '0')}`,
                        compliance: {
                            completed: comp.completed,
                            pending: comp.pending,
                            total: comp.total,
                            completionRate: comp.total > 0 ? ((comp.completed / comp.total) * 100).toFixed(1) : 0
                        },
                        sentiment: {
                            totalEmails: sentiment.totalEmails,
                            negativeCount: sentiment.negativeCount,
                            negativeRate: sentiment.totalEmails > 0
                                ? ((sentiment.negativeCount / sentiment.totalEmails) * 100).toFixed(1)
                                : 0,
                            avgNegativeProb: (sentiment.avgNegativeProb * 100).toFixed(1)
                        }
                    });
                });

            } catch (pgError) {
                console.warn('Could not fetch sentiment data:', pgError.message);
                correlationData.sentimentError = 'Could not connect to sentiment database';

                // Still include compliance data without sentiment
                complianceData.forEach(comp => {
                    correlationData.months.push({
                        year: comp.period_year,
                        month: comp.period_month,
                        label: `${comp.period_year}-${String(comp.period_month).padStart(2, '0')}`,
                        compliance: {
                            completed: comp.completed,
                            pending: comp.pending,
                            total: comp.total,
                            completionRate: comp.total > 0 ? ((comp.completed / comp.total) * 100).toFixed(1) : 0
                        },
                        sentiment: null
                    });
                });
            }
        } else {
            // No email domain - just compliance data
            complianceData.forEach(comp => {
                correlationData.months.push({
                    year: comp.period_year,
                    month: comp.period_month,
                    label: `${comp.period_year}-${String(comp.period_month).padStart(2, '0')}`,
                    compliance: {
                        completed: comp.completed,
                        pending: comp.pending,
                        total: comp.total,
                        completionRate: comp.total > 0 ? ((comp.completed / comp.total) * 100).toFixed(1) : 0
                    },
                    sentiment: null
                });
            });
        }

        res.json(correlationData);

    } catch (error) {
        console.error('Get correlation data error:', error);
        res.status(500).json({ error: 'Failed to get correlation data' });
    } finally {
        if (pgClient) await pgClient.end();
    }
});

module.exports = router;
