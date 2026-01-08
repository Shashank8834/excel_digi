/**
 * Migration Script: Add email_domain column to clients table
 * Also adds indexes for insights queries
 * 
 * Run this ONCE on your server: node src/db/migrate-insights.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting insights migration...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found! Run the app first to create it.');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // 1. Check if email_domain column already exists
        console.log('1. Checking for email_domain column...');

        const tableInfo = db.exec("PRAGMA table_info(clients)");
        let hasEmailDomain = false;

        if (tableInfo.length > 0) {
            const columns = tableInfo[0].values;
            hasEmailDomain = columns.some(col => col[1] === 'email_domain');
        }

        if (!hasEmailDomain) {
            console.log('   Adding email_domain column to clients table...');
            db.run('ALTER TABLE clients ADD COLUMN email_domain TEXT');
            console.log('   ✅ email_domain column added');
        } else {
            console.log('   ⏭️ email_domain column already exists, skipping...');
        }

        // 2. Create index for email_domain lookups
        console.log('2. Creating index for email_domain...');
        try {
            db.run('CREATE INDEX IF NOT EXISTS idx_clients_email_domain ON clients(email_domain)');
            console.log('   ✅ Index created or already exists');
        } catch (e) {
            console.log('   ⏭️ Index already exists');
        }

        // 3. Add temp compliance columns to compliances table
        console.log('3. Checking for temp compliance columns...');
        const complianceInfo = db.exec("PRAGMA table_info(compliances)");
        let hasTempCols = false;
        if (complianceInfo.length > 0) {
            const cols = complianceInfo[0].values;
            hasTempCols = cols.some(col => col[1] === 'is_temporary');
        }

        if (!hasTempCols) {
            console.log('   Adding temp compliance columns...');
            db.run('ALTER TABLE compliances ADD COLUMN is_temporary INTEGER DEFAULT 0');
            db.run('ALTER TABLE compliances ADD COLUMN temp_year INTEGER');
            db.run('ALTER TABLE compliances ADD COLUMN temp_month INTEGER');
            console.log('   ✅ Temp compliance columns added');
        } else {
            console.log('   ⏭️ Temp compliance columns already exist');
        }

        // Save the database
        const data = db.export();
        const dbBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, dbBuffer);

        console.log('\n✅ Insights migration completed successfully!');
        console.log('\nYou can now:');
        console.log('- Set email domains for clients in the admin panel');
        console.log('- View client insights on the dashboard');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        db.close();
    }
}

migrate();
