-- Compliance Work Tracker Database Schema

-- Users table with roles
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'team_member')),
    must_change_password INTEGER DEFAULT 1, -- Force password change on first login
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Teams table (legacy - kept for migration compatibility)
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    notes TEXT,
    channel_mail TEXT, -- Email for overdue notifications
    email_domain TEXT, -- Domain for email sentiment matching (e.g., 'acmecorp.com')
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User-Client assignments (which users can see which clients)
CREATE TABLE IF NOT EXISTS user_client_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    client_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(user_id, client_id)
);

-- Law Groups (e.g., Income Tax, GST, ROC, PF, ESI)
CREATE TABLE IF NOT EXISTS law_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    manager_only INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Client-Law Group assignments (which law groups apply to which clients)
CREATE TABLE IF NOT EXISTS client_law_group_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    law_group_id INTEGER NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (law_group_id) REFERENCES law_groups(id) ON DELETE CASCADE,
    UNIQUE(client_id, law_group_id)
);

-- Compliances under Law Groups with deadline dates
CREATE TABLE IF NOT EXISTS compliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    deadline_day INTEGER, -- Day of month (1-31)
    deadline_month INTEGER, -- Month (1-12) for yearly tasks, NULL for monthly
    frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
    manager_only INTEGER DEFAULT 0, -- Only admin/manager can edit
    instruction_video_url TEXT, -- YouTube video URL for instructions
    instruction_text TEXT, -- Text instructions
    is_temporary INTEGER DEFAULT 0, -- Temporary compliance for specific month only
    temp_month INTEGER, -- Month for temporary compliance
    temp_year INTEGER, -- Year for temporary compliance
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (law_group_id) REFERENCES law_groups(id) ON DELETE CASCADE
);

-- Client Compliance Status tracking
CREATE TABLE IF NOT EXISTS client_compliance_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    compliance_id INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('done', 'pending', 'na')),
    notes TEXT,
    updated_by INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    UNIQUE(client_id, compliance_id, period_year, period_month)
);

-- Audit milestones (yearly audit tracks)
CREATE TABLE IF NOT EXISTS audit_milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    default_deadline_month INTEGER,
    default_deadline_day INTEGER,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Client Audit Status
CREATE TABLE IF NOT EXISTS client_audit_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    audit_milestone_id INTEGER NOT NULL,
    fiscal_year TEXT NOT NULL, -- e.g., "2023-24"
    status TEXT NOT NULL CHECK (status IN ('done', 'pending', 'na')),
    completion_date DATE,
    notes TEXT,
    updated_by INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (audit_milestone_id) REFERENCES audit_milestones(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    UNIQUE(client_id, audit_milestone_id, fiscal_year)
);

-- Monthly client inclusion (which clients are active for which month)
CREATE TABLE IF NOT EXISTS monthly_client_inclusion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    is_included INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, period_year, period_month)
);

-- Monthly compliance deadline overrides (custom deadlines per month)
CREATE TABLE IF NOT EXISTS monthly_compliance_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compliance_id INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    custom_deadline_day INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE,
    UNIQUE(compliance_id, period_year, period_month)
);

-- Default compliance extensions (persists until changed)
CREATE TABLE IF NOT EXISTS default_compliance_extensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    compliance_id INTEGER NOT NULL UNIQUE,
    extension_day INTEGER NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (compliance_id) REFERENCES compliances(id) ON DELETE CASCADE
);

-- Client monthly OneDrive links
CREATE TABLE IF NOT EXISTS client_monthly_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    onedrive_link TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE(client_id, period_year, period_month)
);

-- Month locks (for T+1 locking policy)
CREATE TABLE IF NOT EXISTS month_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_year INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    unlocked_until DATETIME, -- Temporarily unlocked until this time
    unlocked_by INTEGER,
    FOREIGN KEY (unlocked_by) REFERENCES users(id),
    UNIQUE(period_year, period_month)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_client_compliance_status_lookup 
ON client_compliance_status(client_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_compliances_law_group 
ON compliances(law_group_id);

CREATE INDEX IF NOT EXISTS idx_user_client_assignments_user 
ON user_client_assignments(user_id);

CREATE INDEX IF NOT EXISTS idx_monthly_client_inclusion
ON monthly_client_inclusion(period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_client_monthly_links
ON client_monthly_links(client_id, period_year, period_month);

