// Migration: Allow NULL law_group_id for client-specific tasks
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/compliance.db');
const db = new Database(dbPath);

console.log('Migrating compliances table to allow NULL law_group_id...');

try {
    // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
    // First, check if we need to migrate by trying to insert a row with NULL law_group_id

    // Check current schema
    const tableInfo = db.prepare("PRAGMA table_info(compliances)").all();
    const lawGroupCol = tableInfo.find(col => col.name === 'law_group_id');

    if (lawGroupCol && lawGroupCol.notnull === 1) {
        console.log('law_group_id is currently NOT NULL, migrating...');

        db.exec('BEGIN TRANSACTION');

        // Create new table without NOT NULL constraint on law_group_id
        db.exec(`
            CREATE TABLE compliances_new (
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
        db.exec(`
            INSERT INTO compliances_new 
            SELECT id, law_group_id, name, description, deadline_day, deadline_month, frequency, manager_only, 
                   instruction_video_url, instruction_text, is_temporary, temp_month, temp_year, 
                   applicable_client_ids, display_order, is_active, created_at
            FROM compliances
        `);

        // Drop old table and rename new one
        db.exec('DROP TABLE compliances');
        db.exec('ALTER TABLE compliances_new RENAME TO compliances');

        db.exec('COMMIT');

        console.log('Migration completed successfully!');
    } else {
        console.log('law_group_id already allows NULL, no migration needed.');
    }
} catch (error) {
    console.error('Migration error:', error);
    db.exec('ROLLBACK');
    process.exit(1);
}

db.close();
console.log('Done!');
