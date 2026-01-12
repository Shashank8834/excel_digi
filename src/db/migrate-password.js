/**
 * Migration script to add must_change_password column to existing databases
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('=== Password Migration ===');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.log('No database file found. Migration not needed.');
        return;
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // Check if column already exists
        const tableInfo = db.exec("PRAGMA table_info(users)");
        const columns = tableInfo[0]?.values.map(row => row[1]) || [];

        if (columns.includes('must_change_password')) {
            console.log('Column must_change_password already exists. Skipping migration.');
        } else {
            console.log('Adding must_change_password column to users table...');
            db.run('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 1');

            // Set existing users to not require password change (they already have passwords)
            console.log('Setting existing users to not require password change...');
            db.run('UPDATE users SET must_change_password = 0');

            console.log('Migration completed successfully!');
        }

        // Save the database
        const data = db.export();
        const dbBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, dbBuffer);
        console.log('Database saved.');

    } catch (error) {
        console.error('Migration error:', error);
    } finally {
        db.close();
    }
}

migrate().catch(console.error);
