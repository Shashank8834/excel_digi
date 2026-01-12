/**
 * Database Reset Script
 * Deletes the existing database and creates a fresh one with new admin credentials
 * 
 * Usage: node src/db/reset-db.js
 */

const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'tracker.db');

async function resetDatabase() {
    console.log('=== Database Reset ===');
    console.log('Database path:', dbPath);

    // Delete existing database
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('Deleted existing database.');
    } else {
        console.log('No existing database found.');
    }

    // Import and initialize fresh database
    const { initializeDatabase, seedDemoData, initDatabase } = require('./database');

    await initDatabase();
    await initializeDatabase();
    seedDemoData();

    console.log('\n=== Database Reset Complete ===');
    console.log('New admin credentials:');
    console.log('  Email: admin@bcl.in');
    console.log('  Password: BCLindia2026@#');
    console.log('\nYou can now start the server with: npm run dev');
}

resetDatabase().catch(console.error);
