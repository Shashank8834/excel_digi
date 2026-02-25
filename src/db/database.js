const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Database stored in /app/data for Docker persistence
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');
let db = null;

// Initialize sql.js and load/create database
async function initDatabase() {
    const SQL = await initSqlJs();

    // Try to load existing database
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
        console.log('Loaded existing database');
    } else {
        db = new SQL.Database();
        console.log('Created new database');
    }

    return db;
}

// Save database to file
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

// Initialize database with schema
async function initializeDatabase() {
    if (!db) {
        await initDatabase();
    }

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Split by semicolon and execute each statement
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
        try {
            db.run(stmt);
        } catch (e) {
            // Ignore errors for CREATE IF NOT EXISTS
            if (!e.message.includes('already exists')) {
                console.error('Schema error:', e.message);
            }
        }
    }

    saveDatabase();
    console.log('Database initialized successfully');
}

// Wrapper to match better-sqlite3 API
const dbWrapper = {
    prepare: function (sql) {
        return {
            run: function (...params) {
                db.run(sql, params);
                const result = db.exec('SELECT last_insert_rowid() as lastInsertRowid');
                const lastInsertRowid = result.length > 0 ? result[0].values[0][0] : 0;
                const changes = db.getRowsModified();
                saveDatabase();
                return { lastInsertRowid, changes };
            },
            get: function (...params) {
                const stmt = db.prepare(sql);
                stmt.bind(params);
                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    stmt.free();
                    return row;
                }
                stmt.free();
                return undefined;
            },
            all: function (...params) {
                const stmt = db.prepare(sql);
                stmt.bind(params);
                const results = [];
                while (stmt.step()) {
                    results.push(stmt.getAsObject());
                }
                stmt.free();
                return results;
            }
        };
    },
    exec: function (sql) {
        db.exec(sql);
        saveDatabase();
    },
    pragma: function (pragma) {
        if (pragma === 'foreign_keys = ON') {
            db.run('PRAGMA foreign_keys = ON');
        }
    }
};

// Seed initial data - only admin user for fresh start
function seedDemoData() {
    const bcrypt = require('bcryptjs');

    // Check if any users already exist
    const result = db.exec('SELECT COUNT(*) as count FROM users');
    const userCount = result.length > 0 ? result[0].values[0][0] : 0;

    if (userCount > 0) {
        console.log('Users already exist, skipping seed');
        return;
    }

    // Create only the admin user - password: "BCLindia2026@#"
    const passwordHash = bcrypt.hashSync('BCLindia2026@#', 10);
    db.run('INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)',
        ['Admin', 'admin@bcl.in', passwordHash, 'admin', 0]);

    saveDatabase();
    console.log('Admin user created: admin@bcl.in / BCLindia2026@#');
}

module.exports = { db: dbWrapper, initializeDatabase, seedDemoData, initDatabase };
