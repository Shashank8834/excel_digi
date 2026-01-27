/**
 * Migration: Add client_excluded_compliances table
 * 
 * Usage: node src/db/migrate-excluded-compliances.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting migration: client_excluded_compliances...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found!');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // Create client_excluded_compliances table
        console.log('Creating client_excluded_compliances table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS client_excluded_compliances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                compliance_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
                UNIQUE(client_id, compliance_id)
            )
        `);
        console.log('✓ client_excluded_compliances table created');

        // Create index
        console.log('Creating indexes...');
        db.run(`CREATE INDEX IF NOT EXISTS idx_client_excluded_compliances ON client_excluded_compliances(client_id)`);
        console.log('✓ Indexes created');

        // Save the database
        const data = db.export();
        const outputBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, outputBuffer);

        console.log('\n✅ Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
