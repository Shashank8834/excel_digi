const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Check if we're on Vercel (serverless)
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const dbPath = path.join(__dirname, 'tracker.db');
let db = null;

// Initialize sql.js and create in-memory database
async function initDatabase() {
    try {
        console.log('Initializing sql.js...');
        console.log('Serverless mode:', isServerless);

        const SQL = await initSqlJs();
        console.log('sql.js loaded successfully');

        // Always use in-memory database for simplicity
        db = new SQL.Database();
        console.log('In-memory database created');

        return db;
    } catch (error) {
        console.error('initDatabase error:', error.message);
        console.error('Stack:', error.stack);
        throw error;
    }
}

// Save database to file (only works in local mode)
function saveDatabase() {
    if (db && !isServerless) {
        try {
            const data = db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(dbPath, buffer);
        } catch (e) {
            // Ignore file system errors in serverless
        }
    }
}

// Embedded schema for serverless
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('manager', 'team_member')),
    team_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_client_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(team_id, client_id)
);

CREATE TABLE IF NOT EXISTS law_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_law_group_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    law_group_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (law_group_id) REFERENCES law_groups(id) ON DELETE CASCADE,
    UNIQUE(client_id, law_group_id)
);

CREATE TABLE IF NOT EXISTS compliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    deadline_day INTEGER NOT NULL,
    deadline_month INTEGER,
    frequency TEXT DEFAULT 'monthly' CHECK(frequency IN ('monthly', 'quarterly', 'yearly', 'one-time')),
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (law_group_id) REFERENCES law_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_compliance_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    compliance_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'na')),
    notes TEXT,
    updated_by INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    UNIQUE(client_id, compliance_id, year, month)
);

CREATE TABLE IF NOT EXISTS monthly_deadline_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compliance_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    deadline_day INTEGER NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE(compliance_id, year, month)
);

CREATE TABLE IF NOT EXISTS active_monthly_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, year, month)
);
`;

// Initialize database with schema
async function initializeDatabase() {
    if (!db) {
        await initDatabase();
    }

    // Use embedded schema for serverless, file for local
    let schema;
    if (isServerless) {
        schema = SCHEMA;
    } else {
        try {
            const schemaPath = path.join(__dirname, 'schema.sql');
            schema = fs.readFileSync(schemaPath, 'utf8');
        } catch (e) {
            schema = SCHEMA;
        }
    }

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
