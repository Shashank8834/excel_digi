/**
 * Database Migration Script for Compliance Tracker Improvements
 * Adds associate_partner role, applicable_client_ids column, and client_compliance_applicability table
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
        // 1. Recreate users table with new role constraint (SQLite limitation - cannot alter CHECK)
        console.log('1. Updating users table to support associate_partner role...');

        // Check if users_new already exists and drop it
        db.run(`DROP TABLE IF EXISTS users_new`);

        // Create new table with updated constraint including associate_partner
        db.run(`
            CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'team_member', 'associate_partner')),
                must_change_password INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Copy data from old table
        db.run(`
            INSERT INTO users_new (id, name, email, password_hash, role, must_change_password, created_at)
            SELECT id, name, email, password_hash, role, must_change_password, created_at FROM users
        `);

        // Drop old table and rename new
        db.run(`DROP TABLE users`);
        db.run(`ALTER TABLE users_new RENAME TO users`);
        console.log('   Users table updated successfully');

        // 2. Check if applicable_client_ids column exists
        console.log('2. Checking for applicable_client_ids column...');
        const complianceInfo = db.exec("PRAGMA table_info(compliances)");
        const columns = complianceInfo[0]?.values || [];
        const hasApplicableClients = columns.some(col => col[1] === 'applicable_client_ids');

        if (!hasApplicableClients) {
            console.log('   Adding applicable_client_ids column to compliances...');
            db.run(`ALTER TABLE compliances ADD COLUMN applicable_client_ids TEXT`);
        } else {
            console.log('   applicable_client_ids column already exists');
        }

        // 3. Create client_compliance_applicability table
        console.log('3. Creating client_compliance_applicability table...');
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

        // 4. Create index for performance
        console.log('4. Creating performance index...');
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
        console.log('- Associate Partner role now supported');
        console.log('- Half-yearly frequency (validation at app level)');
        console.log('- Client-specific compliance applicability');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
