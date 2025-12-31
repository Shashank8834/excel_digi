# Compliance Work Tracker

A compliance tracking system for managing deadlines, law groups, clients, and team assignments.

## Features

- **Dashboard**: Company-wise deadline grouping with expand/collapse
- **Compliance Matrix**: Track compliance status across clients and law groups
- **Client Management**: Assign teams and applicable law groups to clients
- **Team Management**: Create teams and assign members
- **User Management**: Manager can add team leads and members

## Getting Started

### Local Development

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open http://localhost:3000 in your browser.

### Login Credentials

- **Manager**: `manager@company.com` / `password123`

The manager can create additional users and assign them to teams.

## Deployment to Vercel

1. Push this repository to GitHub
2. Go to [Vercel](https://vercel.com) and create a new project
3. Import your GitHub repository
4. Deploy!

> **Note**: The database is recreated fresh on each deployment. For production use, consider using a cloud database like Turso, PlanetScale, or Supabase.

## Tech Stack

- **Backend**: Express.js with sql.js (SQLite in JavaScript)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Database**: SQLite (in-memory for serverless)
