/**
 * Migration: Add 'partner' role to users table
 * Partners have the same rights as Associate Partners
 * 
 * Run: node src/db/migrate-partner-role.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    const SQL = await initSqlJs();

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found:', dbPath);
        process.exit(1);
    }

    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    console.log('Starting migration: Add partner role...');

    try {
        db.run('BEGIN TRANSACTION');

        // 1. Create new users table with updated constraint including partner
        console.log('1. Updating users table to support partner role...');

        db.run(`
            CREATE TABLE IF NOT EXISTS users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'team_member', 'associate_partner', 'partner')),
                must_change_password INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Copy data from old table
        db.run(`
            INSERT INTO users_new (id, name, email, password_hash, role, must_change_password, created_at)
            SELECT id, name, email, password_hash, role, must_change_password, created_at
            FROM users
        `);

        // Drop old table and rename new one
        db.run('DROP TABLE users');
        db.run('ALTER TABLE users_new RENAME TO users');

        db.run('COMMIT');

        // Save database
        const data = db.export();
        fs.writeFileSync(dbPath, Buffer.from(data));

        console.log('Migration completed successfully!');
        console.log('- Partner role now available in user management');
        console.log('- Partners have the same permissions as Associate Partners');
    } catch (error) {
        db.run('ROLLBACK');
        console.error('Migration failed:', error);
        process.exit(1);
    }

    db.close();
}

migrate();
