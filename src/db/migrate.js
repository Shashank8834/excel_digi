/**
 * Database Migration Script
 * Migrates from teams-based to users-based client assignments
 * Run this ONCE on your server before starting the updated app
 * 
 * Usage: node src/db/migrate.js
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function migrate() {
    console.log('Starting database migration...');
    console.log('Database path:', dbPath);

    if (!fs.existsSync(dbPath)) {
        console.error('Database file not found! Nothing to migrate.');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    try {
        // 1. Create user_client_assignments table if not exists
        console.log('1. Creating user_client_assignments table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS user_client_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                UNIQUE(user_id, client_id)
            )
        `);

        // 2. Create default_compliance_extensions table if not exists
        console.log('2. Creating default_compliance_extensions table...');
        db.run(`
            CREATE TABLE IF NOT EXISTS default_compliance_extensions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                compliance_id INTEGER NOT NULL UNIQUE,
                extension_day INTEGER NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE
            )
        `);

        // 3. Migrate team_client_assignments to user_client_assignments
        // For each team-client assignment, create user-client assignments for all users in that team
        console.log('3. Migrating team-client assignments to user-client assignments...');

        // Check if team_client_assignments exists
        const tcaExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='team_client_assignments'");
        if (tcaExists.length > 0 && tcaExists[0].values.length > 0) {
            // Get all team-client assignments
            const teamAssignments = db.exec(`
                SELECT tca.team_id, tca.client_id, u.id as user_id
                FROM team_client_assignments tca
                INNER JOIN users u ON u.team_id = tca.team_id
            `);

            if (teamAssignments.length > 0 && teamAssignments[0].values.length > 0) {
                for (const row of teamAssignments[0].values) {
                    const userId = row[2];
                    const clientId = row[1];
                    try {
                        db.run(`
                            INSERT OR IGNORE INTO user_client_assignments (user_id, client_id)
                            VALUES (?, ?)
                        `, [userId, clientId]);
                    } catch (e) {
                        // Ignore duplicates
                    }
                }
                console.log(`   Migrated ${teamAssignments[0].values.length} assignments`);
            } else {
                console.log('   No team-client assignments to migrate');
            }
        } else {
            console.log('   team_client_assignments table not found, skipping...');
        }

        // 4. Update first manager user to admin role
        console.log('4. Updating first manager to admin role...');
        db.run(`UPDATE users SET role = 'admin' WHERE role = 'manager' AND id = (SELECT MIN(id) FROM users WHERE role = 'manager')`);

        // 5. Create new index
        console.log('5. Creating new index...');
        db.run(`CREATE INDEX IF NOT EXISTS idx_user_client_assignments_user ON user_client_assignments(user_id)`);

        // Save the database
        const data = db.export();
        const outputBuffer = Buffer.from(data);
        fs.writeFileSync(dbPath, outputBuffer);

        console.log('\n✅ Migration completed successfully!');
        console.log('\nNotes:');
        console.log('- The first manager user has been upgraded to admin');
        console.log('- Team-client assignments have been migrated to user-client assignments');
        console.log('- Old teams table is preserved but no longer used');
        console.log('- You can now start the updated application');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
