/**
 * Feature Migration Script
 * Adds manager_only to law_groups and temporary compliance fields
 * 
 * Usage: node src/db/migrate-features.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting feature migration...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found! Run initial migration first.');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // 1. Add manager_only to law_groups
        console.log('1. Adding manager_only to law_groups...');
        try {
            db.run(`ALTER TABLE law_groups ADD COLUMN manager_only INTEGER DEFAULT 0`);
            console.log('   ✓ Added manager_only column');
        } catch (e) {
            console.log('   ✓ manager_only column already exists');
        }

        // 2. Add is_temporary to compliances
        console.log('2. Adding is_temporary to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN is_temporary INTEGER DEFAULT 0`);
            console.log('   ✓ Added is_temporary column');
        } catch (e) {
            console.log('   ✓ is_temporary column already exists');
        }

        // 3. Add temp_month to compliances
        console.log('3. Adding temp_month to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN temp_month INTEGER NULL`);
            console.log('   ✓ Added temp_month column');
        } catch (e) {
            console.log('   ✓ temp_month column already exists');
        }

        // 4. Add temp_year to compliances
        console.log('4. Adding temp_year to compliances...');
        try {
            db.run(`ALTER TABLE compliances ADD COLUMN temp_year INTEGER NULL`);
            console.log('   ✓ Added temp_year column');
        } catch (e) {
            console.log('   ✓ temp_year column already exists');
        }

        // Save the database
        const data = db.export();
        const outputBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, outputBuffer);

        console.log('\n✅ Feature migration completed successfully!');
        console.log('\nNew features enabled:');
        console.log('- Manager-only law groups');
        console.log('- Temporary compliances for specific months');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
