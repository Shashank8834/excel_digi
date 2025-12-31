const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'tracker.db');
let db = null;

// Initialize sql.js and load/create database
async function initDatabase() {
    const SQL = await initSqlJs();

    // Try to load existing database
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
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
                saveDatabase();
                // Get last insert rowid
                const result = db.exec('SELECT last_insert_rowid() as lastInsertRowid');
                return {
                    lastInsertRowid: result.length > 0 ? result[0].values[0][0] : 0,
                    changes: db.getRowsModified()
                };
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
        // sql.js doesn't support PRAGMA in the same way
        if (pragma === 'foreign_keys = ON') {
            db.run('PRAGMA foreign_keys = ON');
        }
    }
};

// Seed initial data - only manager user for fresh start
function seedDemoData() {
    const bcrypt = require('bcryptjs');

    // Check if any users already exist
    const result = db.exec('SELECT COUNT(*) as count FROM users');
    const userCount = result.length > 0 ? result[0].values[0][0] : 0;

    if (userCount > 0) {
        console.log('Users already exist, skipping seed');
        return;
    }

    // Create only the manager user - password: "password123"
    const passwordHash = bcrypt.hashSync('password123', 10);
    db.run('INSERT INTO users (name, email, password_hash, role, team_id) VALUES (?, ?, ?, ?, ?)',
        ['Manager Admin', 'manager@company.com', passwordHash, 'manager', null]);

    saveDatabase();
    console.log('Manager user created: manager@company.com / password123');
}

module.exports = { db: dbWrapper, initializeDatabase, seedDemoData, initDatabase };
