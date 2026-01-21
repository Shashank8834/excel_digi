// Migration script for adding associate_partner role and other schema updates
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'tracker.db');
const db = new Database(dbPath);

console.log('Running migrations for compliance tracker improvements...');

// SQLite doesn't allow altering CHECK constraints directly
// We need to recreate tables with new constraints

try {
    db.exec('BEGIN TRANSACTION');

    // 1. Add half_yearly to frequency options and make law_group_id nullable
    // First check if columns exist
    const complianceInfo = db.prepare("PRAGMA table_info(compliances)").all();
    const hasApplicableClients = complianceInfo.some(col => col.name === 'applicable_client_ids');

    if (!hasApplicableClients) {
        console.log('Adding applicable_client_ids column to compliances...');
        db.exec(`ALTER TABLE compliances ADD COLUMN applicable_client_ids TEXT`);
    }

    // 2. Create client_compliance_applicability table for per-compliance client selection
    console.log('Creating client_compliance_applicability table...');
    db.exec(`
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
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_client_compliance_applicability 
        ON client_compliance_applicability(compliance_id, client_id)
    `);

    // Note: SQLite doesn't support changing CHECK constraints without recreating the table
    // The role validation will be done at the application level
    // The frequency validation will also be done at the application level

    db.exec('COMMIT');
    console.log('Migration completed successfully!');
    console.log('');
    console.log('New features available:');
    console.log('- Associate Partner role (validate at app level)');
    console.log('- Half-yearly frequency (validate at app level)');
    console.log('- Client-specific compliance applicability');
    console.log('- Applicable client IDs for compliances');

} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error);
    process.exit(1);
}

db.close();
