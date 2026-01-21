/**
 * Database Migration Script for Compliance Tracker Improvements
 * Adds applicable_client_ids column and client_compliance_applicability table
 * 
 * Usage: node src/db/migrate-improvements.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Running migrations for compliance tracker improvements...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found! Nothing to migrate.');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // 1. Check if applicable_client_ids column exists
        console.log('1. Checking for applicable_client_ids column...');
        const complianceInfo = db.exec("PRAGMA table_info(compliances)");
        const columns = complianceInfo[0]?.values || [];
        const hasApplicableClients = columns.some(col => col[1] === 'applicable_client_ids');

        if (!hasApplicableClients) {
            console.log('   Adding applicable_client_ids column to compliances...');
            db.run(`ALTER TABLE compliances ADD COLUMN applicable_client_ids TEXT`);
        } else {
            console.log('   applicable_client_ids column already exists');
        }

        // 2. Create client_compliance_applicability table
        console.log('2. Creating client_compliance_applicability table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS client_compliance_applicability (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                compliance_id INTEGER NOT NULL,
                is_applicable INTEGER DEFAULT 1,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
                UNIQUE(client_id, compliance_id)
            )
        `);

        // 3. Create index for performance
        console.log('3. Creating performance index...');
        db.run(`
            CREATE INDEX IF NOT EXISTS idx_client_compliance_applicability 
            ON client_compliance_applicability(compliance_id, client_id)
        `);

        // Save the database
        const data = db.export();
        const outputBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, outputBuffer);

        console.log('\n✅ Migration completed successfully!');
        console.log('\nNew features available:');
        console.log('- Associate Partner role (validation at app level)');
        console.log('- Half-yearly frequency (validation at app level)');
        console.log('- Client-specific compliance applicability');
        console.log('- Applicable client IDs for compliances');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
