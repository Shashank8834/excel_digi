/**
 * Phase 2 Database Migration Script
 * Adds new columns and tables for Phase 2 features
 * 
 * Usage: node src/db/migrate-phase2.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting Phase 2 database migration...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found! Run Phase 1 migration first.');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // 1. Add channel_mail to clients
        console.log('1. Adding channel_mail to clients...');
        try {
            db.run(`ALTER TABLE clients ADD COLUMN channel_mail TEXT`);
            console.log('   Added channel_mail column');
        } catch (e) {
            console.log('   channel_mail column already exists');
        }

        // 2. Add manager_only to compliances
        console.log('2. Adding manager_only to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN manager_only INTEGER DEFAULT 0`);
            console.log('   Added manager_only column');
        } catch (e) {
            console.log('   manager_only column already exists');
        }

        // 3. Add instruction_video_url to compliances
        console.log('3. Adding instruction_video_url to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN instruction_video_url TEXT`);
            console.log('   Added instruction_video_url column');
        } catch (e) {
            console.log('   instruction_video_url column already exists');
        }

        // 4. Add instruction_text to compliances
        console.log('4. Adding instruction_text to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN instruction_text TEXT`);
            console.log('   Added instruction_text column');
        } catch (e) {
            console.log('   instruction_text column already exists');
        }

        // 5. Create client_monthly_links table
        console.log('5. Creating client_monthly_links table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS client_monthly_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                period_year INTEGER NOT NULL,
                period_month INTEGER NOT NULL,
                onedrive_link TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                UNIQUE(client_id, period_year, period_month)
            )
        `);
        console.log('   Created client_monthly_links table');

        // 6. Create month_locks table
        console.log('6. Creating month_locks table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS month_locks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                period_year INTEGER NOT NULL,
                period_month INTEGER NOT NULL,
                unlocked_until DATETIME,
                unlocked_by INTEGER,
                FOREIGN KEY (unlocked_by) REFERENCES users(id),
                UNIQUE(period_year, period_month)
            )
        `);
        console.log('   Created month_locks table');

        // 7. Create index
        console.log('7. Creating indexes...');
        db.run(`CREATE INDEX IF NOT EXISTS idx_client_monthly_links ON client_monthly_links(client_id, period_year, period_month)`);
        console.log('   Created indexes');

        // Save the database
        const data = db.export();
        const outputBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, outputBuffer);

        console.log('\n✅ Phase 2 migration completed successfully!');
        console.log('\nNew features enabled:');
        console.log('- Manager-only compliances');
        console.log('- Instruction manuals for compliances');
        console.log('- Channel mail for clients');
        console.log('- OneDrive links per client per month');
        console.log('- Month locking (T+1 policy)');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
