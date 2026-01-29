/**
 * Migration: Allow NULL law_group_id for client-specific tasks
 * 
 * Usage: node src/db/migrate-nullable-lawgroup.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting migration: nullable law_group_id...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found!');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // Check if law_group_id is NOT NULL
        const tableInfo = db.exec("PRAGMA table_info(compliances)");
        if (tableInfo.length === 0) {
            console.log('Compliances table not found!');
            process.exit(1);
        }

        const columns = tableInfo[0].values;
        const lawGroupCol = columns.find(col => col[1] === 'law_group_id');

        if (lawGroupCol && lawGroupCol[3] === 1) { // notnull = 1
            console.log('law_group_id is NOT NULL, migrating...');

            // Create new table with nullable law_group_id
            db.run(`
                CREATE TABLE IF NOT EXISTS compliances_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    law_group_id INTEGER,
                    name TEXT NOT NULL,
                    description TEXT,
                    deadline_day INTEGER,
                    deadline_month INTEGER,
                    frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'half_yearly')),
                    manager_only INTEGER DEFAULT 0,
                    instruction_video_url TEXT,
                    instruction_text TEXT,
                    is_temporary INTEGER DEFAULT 0,
                    temp_month INTEGER,
                    temp_year INTEGER,
                    applicable_client_ids TEXT,
                    display_order INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (law_group_id) REFERENCES law_groups(id) ON DELETE CASCADE
                )
            `);

            // Copy data
            db.run(`
                INSERT INTO compliances_new 
                SELECT id, law_group_id, name, description, deadline_day, deadline_month, frequency, manager_only, 
                       instruction_video_url, instruction_text, is_temporary, temp_month, temp_year, 
                       applicable_client_ids, display_order, is_active, created_at
                FROM compliances
            `);

            // Drop old table and rename
            db.run('DROP TABLE compliances');
            db.run('ALTER TABLE compliances_new RENAME TO compliances');

            console.log('Migration completed!');
        } else {
            console.log('law_group_id already allows NULL, no migration needed.');
        }

        // Save the database
        const data = db.export();
        const dataBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, dataBuffer);
        console.log('Database saved successfully!');

    } catch (error) {
        console.error('Migration error:', error);
        process.exit(1);
    }

    db.close();
}

migrate();
