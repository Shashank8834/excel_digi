// ===== GLOBAL STATE =====
let currentUser = null;
let currentPage = 'dashboard';
let currentMonth = 1; // Start from January 2026
let currentYear = 2026;
let calendarYear = 2026;
let calendarMonth = 1;
let cachedLawGroups = [];
let cachedUsers = [];

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token || !userStr) {
        window.location.href = '/login.html';
        return;
    }

    try {
        currentUser = JSON.parse(userStr);
        initializeUI();
        await loadInitialData();
        navigateTo('dashboard');
    } catch (error) {
        console.error('Initialization error:', error);
        logout();
    }
});

function initializeUI() {
    // Update user info in sidebar
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role.replace('_', ' ');
    document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();

    // Show admin sections for admin role
    if (currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
        document.querySelectorAll('.manager-only').forEach(el => el.style.display = 'block');
    } else if (currentUser.role === 'manager') {
        document.querySelectorAll('.manager-only').forEach(el => el.style.display = 'block');
    }

    // Setup navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });

    // Setup month selectors
    populateMonthSelectors();

    // Setup matrix filters
    setupMatrixFilters();
}

function populateMonthSelectors() {
    // Just update the labels - buttons handle navigation now
    updateMonthLabels();
}

function updateMonthLabels() {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const label = `${months[currentMonth - 1]} ${currentYear}`;
    const dashboardLabel = document.getElementById('dashboardMonthLabel');
    const matrixLabel = document.getElementById('matrixMonthLabel');

    if (dashboardLabel) dashboardLabel.textContent = label;
    if (matrixLabel) matrixLabel.textContent = label;
}

function changeMonth(context, direction) {
    // Calculate new month
    let newMonth = currentMonth + direction;
    let newYear = currentYear;

    if (newMonth > 12) {
        newMonth = 1;
        newYear++;
    } else if (newMonth < 1) {
        newMonth = 12;
        newYear--;
    }

    // Prevent going before Jan 2026
    if (newYear < 2026 || (newYear === 2026 && newMonth < 1)) {
        return; // Don't navigate
    }

    currentMonth = newMonth;
    currentYear = newYear;
    updateMonthLabels();

    if (context === 'dashboard') {
        loadDashboard();
    } else if (context === 'matrix') {
        loadMatrix();
    }
}

// Matrix filters event listeners (called from initializeUI)
function setupMatrixFilters() {
    document.getElementById('matrixLawGroup').addEventListener('change', loadMatrix);
    document.getElementById('matrixStatus').addEventListener('change', loadMatrix);
}

async function loadInitialData() {
    try {
        // Load law groups for filter
        const lawGroupsRes = await apiCall('/api/law-groups');
        cachedLawGroups = lawGroupsRes;

        const lawGroupSelect = document.getElementById('matrixLawGroup');
        lawGroupSelect.innerHTML = '<option value="">All Law Groups</option>' +
            cachedLawGroups.map(lg => `<option value="${lg.id}">${lg.name}</option>`).join('');

        // Load users for admin
        if (currentUser.role === 'admin' || currentUser.role === 'manager') {
            const usersRes = await apiCall('/api/users');
            cachedUsers = usersRes;
        }
    } catch (error) {
        showToast('Failed to load initial data', 'error');
    }
}

// ===== NAVIGATION =====
function navigateTo(page) {
    currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.style.display = 'block';

    // Load page data
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'matrix':
            loadMatrix();
            break;
        case 'calendar':
            loadCalendar();
            break;
        case 'monthsetup':
            loadMonthSetup();
            break;
        case 'clients':
            loadClients();
            break;
        case 'lawgroups':
            loadLawGroups();
            break;
        case 'users':
            loadUsers();
            break;
        case 'insights':
            loadInsights();
            break;
    }
}

// ===== API HELPERS =====
async function apiCall(url, options = {}) {
    const token = localStorage.getItem('token');

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });

    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) {
            logout();
            throw new Error('Session expired');
        }
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }

    return data;
}

// ===== DASHBOARD =====
async function loadDashboard() {
    try {
        // Load summary stats
        const summary = await apiCall(`/api/status/summary?year=${currentYear}&month=${currentMonth}`);

        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card">
                <div class="stat-value">${summary.total_clients || 0}</div>
                <div class="stat-label">Total Clients</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${summary.total_compliances || 0}</div>
                <div class="stat-label">Total Compliances</div>
            </div>
            <div class="stat-card">
                <div class="stat-value stat-done">${summary.done_count || 0}</div>
                <div class="stat-label">Completed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value stat-pending">${summary.pending_count || 0}</div>
                <div class="stat-label">Pending</div>
            </div>
        `;

        // Load all deadlines
        const deadlines = await apiCall('/api/status/deadlines');
        const urgentItems = deadlines.filter(d => ['overdue', 'today', 'warning'].includes(d.urgency));

        if (urgentItems.length === 0) {
            document.getElementById('urgentDeadlines').innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48" style="margin: 0 auto 1rem; opacity: 0.5;">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <p>No urgent deadlines! All caught up.</p>
                </div>
            `;
            return;
        }

        // Group deadlines by company
        const groupedByCompany = {};
        deadlines.forEach(item => {
            const clientKey = `${item.client_id}-${item.client_name}`;
            if (!groupedByCompany[clientKey]) {
                groupedByCompany[clientKey] = {
                    client_id: item.client_id,
                    client_name: item.client_name,
                    items: [],
                    doneCount: 0,
                    totalCount: 0
                };
            }
            groupedByCompany[clientKey].items.push(item);
            groupedByCompany[clientKey].totalCount++;
        });

        // Sort companies by most urgent items first
        const urgencyOrder = { overdue: 0, today: 1, warning: 2, upcoming: 3, normal: 4 };
        const sortedCompanies = Object.values(groupedByCompany).sort((a, b) => {
            const aUrgency = Math.min(...a.items.map(i => urgencyOrder[i.urgency]));
            const bUrgency = Math.min(...b.items.map(i => urgencyOrder[i.urgency]));
            return aUrgency - bUrgency;
        });

        // Build company sections HTML
        let html = '<div class="company-deadlines-container">';

        for (const company of sortedCompanies) {
            const urgentCount = company.items.filter(i => ['overdue', 'today', 'warning'].includes(i.urgency)).length;
            const hasUrgent = urgentCount > 0;
            const mostUrgentItem = company.items.reduce((a, b) =>
                urgencyOrder[a.urgency] < urgencyOrder[b.urgency] ? a : b, company.items[0]);

            const urgencyClass = hasUrgent ? `company-urgency-${mostUrgentItem.urgency}` : '';

            html += `
                <div class="company-deadline-section ${urgencyClass}" data-company-id="${company.client_id}">
                    <div class="company-header" onclick="toggleCompanySection(${company.client_id})">
                        <div class="company-info">
                            <span class="company-toggle-icon" id="toggle-icon-${company.client_id}">▶</span>
                            <span class="company-name">${escapeHtml(company.client_name)}</span>
                        </div>
                        <div class="company-stats">
                            <span class="company-urgent-count ${hasUrgent ? 'has-urgent' : ''}">${urgentCount} urgent</span>
                            <span class="company-total-count">${company.totalCount} total deadlines</span>
                        </div>
                    </div>
                    <div class="company-deadlines collapsed" id="deadlines-${company.client_id}">
                        <table class="matrix-table">
                            <thead>
                                <tr>
                                    <th>Compliance</th>
                                    <th>Law Group</th>
                                    <th>Deadline</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${company.items.map(item => `
                                    <tr class="deadline-row-${item.urgency}">
                                        <td>${escapeHtml(item.compliance_name)}</td>
                                        <td>${escapeHtml(item.law_group_name)}</td>
                                        <td>
                                            <span class="deadline-${item.urgency}">
                                                ${item.deadline_day}th ${getMonthName(currentMonth)}
                                                ${item.urgency === 'overdue' ? '(Overdue)' :
                    item.urgency === 'today' ? '(Today!)' :
                        item.urgency === 'warning' ? `(${item.days_until_deadline} days left)` :
                            item.urgency === 'upcoming' ? `(${item.days_until_deadline} days)` : ''}
                                            </span>
                                        </td>
                                        <td><span class="status-badge status-pending">PENDING</span></td>
                                        <td>
                                            <button class="btn btn-sm btn-primary" 
                                                    onclick="quickUpdateStatus(${item.client_id}, ${item.compliance_id}, 'done')">
                                                Mark Done
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        html += '</div>';
        document.getElementById('urgentDeadlines').innerHTML = html;

        // Load insights section for managers
        if (currentUser.role === 'admin' || currentUser.role === 'manager') {
            loadDashboardInsights();
        }
    } catch (error) {
        console.error('Dashboard load error:', error);
        showToast('Failed to load dashboard', 'error');
    }
}

// Toggle company section expand/collapse
function toggleCompanySection(companyId) {
    const deadlinesEl = document.getElementById(`deadlines-${companyId}`);
    const toggleIcon = document.getElementById(`toggle-icon-${companyId}`);

    if (deadlinesEl.classList.contains('collapsed')) {
        deadlinesEl.classList.remove('collapsed');
        toggleIcon.textContent = '▼';
    } else {
        deadlinesEl.classList.add('collapsed');
        toggleIcon.textContent = '▶';
    }
}


// ===== COMPLIANCE MATRIX =====
async function loadMatrix() {
    try {
        document.getElementById('matrixContent').innerHTML = `
            <div style="text-align: center; padding: 3rem;">
                <div class="loading-spinner" style="width: 40px; height: 40px;"></div>
                <p style="margin-top: 1rem; color: var(--text-muted);">Loading compliance matrix...</p>
            </div>
        `;

        const matrix = await apiCall(`/api/status/matrix?year=${currentYear}&month=${currentMonth}`);

        // Filter by law group if selected
        const selectedLawGroup = document.getElementById('matrixLawGroup').value;
        const selectedStatus = document.getElementById('matrixStatus').value;

        let lawGroups = matrix.lawGroups;
        if (selectedLawGroup) {
            lawGroups = lawGroups.filter(lg => lg.id === parseInt(selectedLawGroup));
        }

        // Calculate colspan for law groups
        const allCompliances = lawGroups.flatMap(lg => lg.compliances.map(c => ({ ...c, lawGroupName: lg.name })));

        if (allCompliances.length === 0) {
            document.getElementById('matrixContent').innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                    <p>No compliances found. ${currentUser.role === 'manager' ? 'Add law groups and compliances from the Administration menu.' : ''}</p>
                </div>
            `;
            return;
        }

        // Check if current month is editable
        const now = new Date();
        let isEditable = currentYear > now.getFullYear() ||
            (currentYear === now.getFullYear() && currentMonth >= now.getMonth() + 1);

        // Build table
        let html = `
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th class="client-cell" rowspan="2">Client</th>
                        ${lawGroups.map(lg => `
                            <th class="law-group-header" colspan="${lg.compliances.length}">${escapeHtml(lg.name)}</th>
                        `).join('')}
                    </tr>
                    <tr>
                        ${allCompliances.map(c => `
                            <th class="compliance-header" onclick="showComplianceInstructions(${c.id}, '${escapeHtml(c.name)}')" style="cursor: pointer;" title="Click for instructions">
                                <span class="compliance-name">${escapeHtml(c.name)}</span>
                                <span class="compliance-deadline">${c.deadline_day || '-'}${c.deadline_month ? '/' + c.deadline_month : ''}</span>
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
        `;

        // Filter clients by status if needed
        let clients = matrix.matrix;
        if (selectedStatus) {
            clients = clients.filter(row => {
                return allCompliances.some(c => row.statuses[c.id]?.status === selectedStatus);
            });
        }

        for (const row of clients) {
            html += `
                <tr>
                    <td class="client-cell">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div>
                                <span class="client-name">${escapeHtml(row.client.name)}</span>
                                <span class="client-industry">${escapeHtml(row.client.industry || '')}</span>
                            </div>
                            <button class="onedrive-link-btn ${row.client.onedrive_link ? 'has-link' : ''}" 
                                    onclick="showOneDriveModal(${row.client.id}, '${escapeHtml(row.client.name)}')" 
                                    title="${row.client.onedrive_link ? 'View/Edit OneDrive Link' : 'Add OneDrive Link'}">
                                📁
                            </button>
                        </div>
                    </td>
            `;

            for (const comp of allCompliances) {
                const status = row.statuses[comp.id] || { status: 'pending' };
                const urgencyClass = getUrgencyClass(comp.deadline_day, status.status);

                // Filter by status
                if (selectedStatus && status.status !== selectedStatus) {
                    html += `<td class="status-cell ${urgencyClass}">-</td>`;
                    continue;
                }

                // Check if client has OneDrive link for this month
                const hasOnedriveLink = !!row.client.onedrive_link;
                // Role check: only managers and admins can edit via matrix
                const isManagerOrAdmin = currentUser.role === 'manager' || currentUser.role === 'admin';
                const canEdit = isEditable && hasOnedriveLink && isManagerOrAdmin;


                if (canEdit) {
                    html += `
                        <td class="status-cell ${urgencyClass}">
                            <select class="status-select status-${status.status}" 
                                    onchange="updateStatus(${row.client.id}, ${comp.id}, this.value)"
                                    data-client="${row.client.id}" data-compliance="${comp.id}">
                                <option value="pending" ${status.status === 'pending' ? 'selected' : ''}>Pending</option>
                                <option value="done" ${status.status === 'done' ? 'selected' : ''}>Done</option>
                                <option value="na" ${status.status === 'na' ? 'selected' : ''}>N/A</option>
                            </select>
                        </td>
                    `;
                } else if (isEditable && !hasOnedriveLink) {
                    // Grayed out - needs OneDrive link
                    html += `
                        <td class="status-cell ${urgencyClass} compliance-disabled" title="Add OneDrive link first">
                            <span class="status-badge status-${status.status}" style="opacity: 0.5;">
                                ${status.status === 'done' ? 'Done' : status.status === 'na' ? 'N/A' : 'Pending'}
                            </span>
                        </td>
                    `;
                } else {
                    html += `
                        <td class="status-cell ${urgencyClass}" title="Month is locked">
                            <span class="status-badge status-${status.status}">
                                ${status.status === 'done' ? 'Done' : status.status === 'na' ? 'N/A' : 'Pending'}
                            </span>
                        </td>
                    `;
                }
            }

            html += '</tr>';
        }

        html += '</tbody></table>';

        // Check month lock status (only show lock badge if locked)
        const lockStatus = await checkMonthLock();

        if (lockStatus.locked) {
            const unlockBtn = currentUser.role === 'admin'
                ? `<button class="month-unlock-btn" onclick="showUnlockMonthModal()">🔓 Unlock</button>`
                : '';
            html = `<div class="month-lock-badge" style="margin-bottom: 1rem; padding: 0.75rem 1rem;">
                    🔒 This month is locked. ${unlockBtn}
                </div>` + html;
            isEditable = false;
        }

        document.getElementById('matrixContent').innerHTML = html;
    } catch (error) {
        console.error('Matrix load error:', error);
        document.getElementById('matrixContent').innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--urgency-overdue);">
                Failed to load matrix: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

async function updateStatus(clientId, complianceId, newStatus) {
    try {
        await apiCall('/api/status/update', {
            method: 'POST',
            body: JSON.stringify({
                client_id: clientId,
                compliance_id: complianceId,
                year: currentYear,
                month: currentMonth,
                status: newStatus
            })
        });

        // Reload matrix to reflect changes and update colors
        loadMatrix();
    } catch (error) {
        showToast(error.message, 'error');
        // Reload to reset dropdown to previous value
        loadMatrix();
    }
}

async function quickUpdateStatus(clientId, complianceId, status) {
    try {
        await apiCall('/api/status/update', {
            method: 'POST',
            body: JSON.stringify({
                client_id: clientId,
                compliance_id: complianceId,
                year: currentYear,
                month: currentMonth,
                status: status
            })
        });

        showToast('Status updated successfully', 'success');
        loadDashboard();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function getUrgencyClass(deadlineDay, status) {
    if (status !== 'pending') return '';

    const now = new Date();
    if (now.getFullYear() !== currentYear || now.getMonth() + 1 !== currentMonth) return '';

    const currentDay = now.getDate();
    const daysUntil = deadlineDay - currentDay;

    if (daysUntil < 0) return 'urgency-overdue';
    if (daysUntil === 0) return 'urgency-today';
    if (daysUntil <= 2) return 'urgency-warning';
    if (daysUntil <= 7) return 'urgency-upcoming';
    return '';
}

function getUrgencyText(urgencyClass) {
    const texts = {
        'urgency-overdue': 'OVERDUE',
        'urgency-today': 'DUE TODAY',
        'urgency-warning': '1-2 DAYS',
        'urgency-upcoming': 'UPCOMING'
    };
    return texts[urgencyClass] || '';
}

// ===== DEADLINES PAGE =====
async function loadDeadlines() {
    try {
        const deadlines = await apiCall('/api/status/deadlines');

        if (deadlines.length === 0) {
            document.getElementById('deadlinesContent').innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48" style="margin: 0 auto 1rem; opacity: 0.5;">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <p>No pending deadlines this month!</p>
                </div>
            `;
            return;
        }

        // Group by urgency
        const groups = {
            overdue: deadlines.filter(d => d.urgency === 'overdue'),
            today: deadlines.filter(d => d.urgency === 'today'),
            warning: deadlines.filter(d => d.urgency === 'warning'),
            upcoming: deadlines.filter(d => d.urgency === 'upcoming'),
            normal: deadlines.filter(d => d.urgency === 'normal')
        };

        let html = '';

        const sections = [
            { key: 'overdue', title: '🔴 Overdue', color: 'var(--urgency-overdue)' },
            { key: 'today', title: '⚠️ Due Today', color: 'var(--urgency-today)' },
            { key: 'warning', title: '🟠 Due in 1-2 Days', color: 'var(--urgency-warning)' },
            { key: 'upcoming', title: '🟡 Due in 3-7 Days', color: 'var(--urgency-upcoming)' },
            { key: 'normal', title: '📅 Other Pending', color: 'var(--text-secondary)' }
        ];

        for (const section of sections) {
            if (groups[section.key].length === 0) continue;

            html += `
                <div style="margin-bottom: 2rem;">
                    <h3 style="color: ${section.color}; margin-bottom: 1rem;">${section.title} (${groups[section.key].length})</h3>
                    <table class="matrix-table">
                        <thead>
                            <tr>
                                <th>Client</th>
                                <th>Compliance</th>
                                <th>Law Group</th>
                                <th>Deadline</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${groups[section.key].map(item => `
                                <tr>
                                    <td>${escapeHtml(item.client_name)}</td>
                                    <td>${escapeHtml(item.compliance_name)}</td>
                                    <td>${escapeHtml(item.law_group_name)}</td>
                                    <td>${item.deadline_day}th</td>
                                    <td>
                                        <button class="btn btn-sm btn-primary" 
                                                onclick="quickUpdateStatus(${item.client_id}, ${item.compliance_id}, 'done')">
                                            Mark Done
                                        </button>
                                        <button class="btn btn-sm btn-secondary" 
                                                onclick="quickUpdateStatus(${item.client_id}, ${item.compliance_id}, 'na')">
                                            N/A
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        document.getElementById('deadlinesContent').innerHTML = html;
    } catch (error) {
        showToast('Failed to load deadlines', 'error');
    }
}

// ===== CLIENTS MANAGEMENT =====
async function loadClients() {
    try {
        const clients = await apiCall('/api/clients');

        document.getElementById('clientsContent').innerHTML = `
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Industry</th>
                        <th>Assigned Users</th>
                        <th>Law Groups</th>
                        <th>Notes</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${clients.map(c => `
                        <tr>
                            <td><strong>${escapeHtml(c.name)}</strong></td>
                            <td>${escapeHtml(c.industry || '-')}</td>
                            <td>${escapeHtml(c.assigned_users || 'None')}</td>
                            <td>${escapeHtml(c.assigned_law_groups || 'All')}</td>
                            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(c.notes || '-')}</td>
                            <td>
                                <button class="btn btn-sm btn-secondary" onclick="editClient(${c.id})">Edit</button>
                                <button class="btn btn-sm btn-secondary" onclick="deleteClient(${c.id})" style="color: var(--urgency-overdue);">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Failed to load clients', 'error');
    }
}

function showAddClientModal() {
    document.getElementById('modalTitle').textContent = 'Add New Client';
    document.getElementById('modalBody').innerHTML = `
        <form id="clientForm">
            <div class="form-group">
                <label class="form-label">Client Name *</label>
                <input type="text" class="form-input" name="name" required>
            </div>
            <div class="form-group">
                <label class="form-label">Industry</label>
                <input type="text" class="form-input" name="industry" placeholder="e.g., IT/ITes, Manufacturing">
            </div>
            <div class="form-group">
                <label class="form-label">Channel Email (for overdue notifications)</label>
                <input type="email" class="form-input" name="channel_mail" placeholder="e.g., team-channel@company.com">
            </div>
            <div class="form-group">
                <label class="form-label">Email Domain (for sentiment tracking)</label>
                <input type="text" class="form-input" name="email_domain" placeholder="e.g., acmecorp.com">
                <small style="color: var(--text-muted);">Used to match emails in sentiment analysis</small>
            </div>
            <div class="form-group">
                <label class="form-label">Assign to Users</label>
                <select class="form-select" name="user_ids" multiple style="height: 100px;">
                    ${cachedUsers.map(u => `<option value="${u.id}">${u.name} (${u.role})</option>`).join('')}
                </select>
                <small style="color: var(--text-muted);">Hold Ctrl/Cmd to select multiple</small>
            </div>
            <div class="form-group">
                <label class="form-label">Applicable Law Groups</label>
                <select class="form-select" name="law_group_ids" multiple style="height: 120px;">
                    ${cachedLawGroups.map(lg => `<option value="${lg.id}">${lg.name}</option>`).join('')}
                </select>
                <small style="color: var(--text-muted);">Select which law groups apply to this client. If none selected, all apply.</small>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-textarea" name="notes" placeholder="Additional notes..."></textarea>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('clientForm');
        const data = {
            name: form.name.value,
            industry: form.industry.value,
            channel_mail: form.channel_mail.value || null,
            email_domain: form.email_domain.value || null,
            notes: form.notes.value,
            user_ids: Array.from(form.user_ids.selectedOptions).map(o => parseInt(o.value)),
            law_group_ids: Array.from(form.law_group_ids.selectedOptions).map(o => parseInt(o.value))
        };

        try {
            await apiCall('/api/clients', { method: 'POST', body: JSON.stringify(data) });
            showToast('Client created successfully', 'success');
            closeModal();
            loadClients();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}

async function editClient(id) {
    try {
        const client = await apiCall(`/api/clients/${id}`);

        document.getElementById('modalTitle').textContent = 'Edit Client';
        document.getElementById('modalBody').innerHTML = `
            <form id="clientForm">
                <div class="form-group">
                    <label class="form-label">Client Name *</label>
                    <input type="text" class="form-input" name="name" value="${escapeHtml(client.name)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Industry</label>
                    <input type="text" class="form-input" name="industry" value="${escapeHtml(client.industry || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label">Channel Email (for overdue notifications)</label>
                    <input type="email" class="form-input" name="channel_mail" value="${escapeHtml(client.channel_mail || '')}" placeholder="e.g., team-channel@company.com">
                </div>
                <div class="form-group">
                    <label class="form-label">Email Domain (for sentiment tracking)</label>
                    <input type="text" class="form-input" name="email_domain" value="${escapeHtml(client.email_domain || '')}" placeholder="e.g., acmecorp.com">
                    <small style="color: var(--text-muted);">Used to match emails in sentiment analysis</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Assign to Users</label>
                    <select class="form-select" name="user_ids" multiple style="height: 100px;">
                        ${cachedUsers.map(u => `<option value="${u.id}" ${client.user_ids && client.user_ids.includes(u.id) ? 'selected' : ''}>${u.name} (${u.role})</option>`).join('')}
                    </select>
                    <small style="color: var(--text-muted);">Hold Ctrl/Cmd to select multiple</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Applicable Law Groups</label>
                    <select class="form-select" name="law_group_ids" multiple style="height: 120px;">
                        ${cachedLawGroups.map(lg => `<option value="${lg.id}" ${client.law_group_ids && client.law_group_ids.includes(lg.id) ? 'selected' : ''}>${lg.name}</option>`).join('')}
                    </select>
                    <small style="color: var(--text-muted);">Select which law groups apply to this client. If none selected, all apply.</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Notes</label>
                    <textarea class="form-textarea" name="notes">${escapeHtml(client.notes || '')}</textarea>
                </div>
            </form>
        `;

        document.getElementById('modalSubmit').onclick = async () => {
            const form = document.getElementById('clientForm');
            const data = {
                name: form.name.value,
                industry: form.industry.value,
                channel_mail: form.channel_mail.value || null,
                email_domain: form.email_domain.value || null,
                notes: form.notes.value,
                user_ids: Array.from(form.user_ids.selectedOptions).map(o => parseInt(o.value)),
                law_group_ids: Array.from(form.law_group_ids.selectedOptions).map(o => parseInt(o.value))
            };

            try {
                await apiCall(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                showToast('Client updated successfully', 'success');
                closeModal();
                loadClients();
            } catch (error) {
                showToast(error.message, 'error');
            }
        };

        openModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteClient(id) {
    if (!confirm('Are you sure you want to deactivate this client?')) return;

    try {
        await apiCall(`/api/clients/${id}`, { method: 'DELETE' });
        showToast('Client deactivated successfully', 'success');
        loadClients();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LAW GROUPS MANAGEMENT =====
async function loadLawGroups() {
    try {
        const lawGroups = await apiCall('/api/law-groups');

        let html = '<div class="admin-grid">';

        for (const lg of lawGroups) {
            html += `
                <div class="admin-card">
                    <div class="admin-card-header">
                        <span class="admin-card-title">${escapeHtml(lg.name)}</span>
                        <div>
                            <button class="btn btn-sm btn-secondary" onclick="addCompliance(${lg.id}, '${escapeHtml(lg.name)}')">
                                + Add Compliance
                            </button>
                        </div>
                    </div>
                    <div class="admin-card-body">
                        ${lg.compliances.length === 0 ? '<p style="color: var(--text-muted);">No compliances yet</p>' : ''}
                        ${lg.compliances.map(c => `
                            <div class="admin-list-item">
                                <div class="admin-list-item-content">
                                    <div class="admin-list-item-title">${escapeHtml(c.name)}</div>
                                    <div class="admin-list-item-subtitle">
                                        Due: ${c.deadline_day || '-'}${c.deadline_month ? '/' + c.deadline_month : ''} | ${c.frequency}
                                    </div>
                                </div>
                                <div class="admin-list-item-actions">
                                    <button class="btn btn-sm btn-secondary" onclick="editCompliance(${c.id})">Edit</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += '</div>';

        document.getElementById('lawGroupsContent').innerHTML = html;
    } catch (error) {
        showToast('Failed to load law groups', 'error');
    }
}

function showAddLawGroupModal() {
    document.getElementById('modalTitle').textContent = 'Add Law Group';
    document.getElementById('modalBody').innerHTML = `
        <form id="lawGroupForm">
            <div class="form-group">
                <label class="form-label">Law Group Name *</label>
                <input type="text" class="form-input" name="name" placeholder="e.g., Income Tax, GST, ROC" required>
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-textarea" name="description" placeholder="Description of this law group..."></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Display Order</label>
                <input type="number" class="form-input" name="display_order" value="0">
            </div>
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input type="checkbox" name="manager_only" style="width: auto;">
                    <span class="form-label" style="margin: 0;">Manager/Admin Only</span>
                </label>
                <small style="color: var(--text-muted);">Only managers and admins can update statuses for compliances in this law group</small>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('lawGroupForm');
        const data = {
            name: form.name.value,
            description: form.description.value,
            display_order: parseInt(form.display_order.value) || 0,
            manager_only: form.manager_only.checked
        };

        try {
            await apiCall('/api/law-groups', { method: 'POST', body: JSON.stringify(data) });
            showToast('Law group created successfully', 'success');
            closeModal();
            loadLawGroups();
            loadInitialData(); // Refresh cached law groups
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}


function addCompliance(lawGroupId, lawGroupName) {
    document.getElementById('modalTitle').textContent = `Add Compliance to ${lawGroupName}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="complianceForm">
            <div class="form-group">
                <label class="form-label">Compliance Name *</label>
                <input type="text" class="form-input" name="name" placeholder="e.g., GSTR-1 Filing" required>
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-textarea" name="description" placeholder="What this compliance involves..."></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Frequency *</label>
                <select class="form-select" name="frequency" required>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Deadline Day (1-31)</label>
                <input type="number" class="form-input" name="deadline_day" min="1" max="31" placeholder="e.g., 15">
            </div>
            <div class="form-group">
                <label class="form-label">Deadline Month (1-12, for yearly compliances)</label>
                <input type="number" class="form-input" name="deadline_month" min="1" max="12" placeholder="e.g., 3 for March">
            </div>
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input type="checkbox" name="manager_only" style="width: auto;">
                    <span class="form-label" style="margin: 0;">Manager/Admin Only</span>
                </label>
                <small style="color: var(--text-muted);">Only managers and admins can update this compliance status</small>
            </div>
            <div class="form-group">
                <label class="form-label">Instruction Video URL (YouTube)</label>
                <input type="url" class="form-input" name="instruction_video_url" placeholder="e.g., https://youtube.com/watch?v=...">
            </div>
            <div class="form-group">
                <label class="form-label">Instruction Text</label>
                <textarea class="form-textarea" name="instruction_text" placeholder="Step-by-step instructions..." rows="4"></textarea>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('complianceForm');
        const data = {
            law_group_id: lawGroupId,
            name: form.name.value,
            description: form.description.value,
            frequency: form.frequency.value,
            deadline_day: form.deadline_day.value ? parseInt(form.deadline_day.value) : null,
            deadline_month: form.deadline_month.value ? parseInt(form.deadline_month.value) : null,
            manager_only: form.manager_only.checked,
            instruction_video_url: form.instruction_video_url.value || null,
            instruction_text: form.instruction_text.value || null
        };

        try {
            await apiCall('/api/compliances', { method: 'POST', body: JSON.stringify(data) });
            showToast('Compliance created successfully', 'success');
            closeModal();
            loadLawGroups();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}

async function editCompliance(id) {
    try {
        const compliance = await apiCall(`/api/compliances/${id}`);

        document.getElementById('modalTitle').textContent = 'Edit Compliance';
        document.getElementById('modalBody').innerHTML = `
            <form id="complianceForm">
                <div class="form-group">
                    <label class="form-label">Compliance Name *</label>
                    <input type="text" class="form-input" name="name" value="${escapeHtml(compliance.name)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-textarea" name="description">${escapeHtml(compliance.description || '')}</textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Frequency *</label>
                    <select class="form-select" name="frequency" required>
                        <option value="monthly" ${compliance.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                        <option value="quarterly" ${compliance.frequency === 'quarterly' ? 'selected' : ''}>Quarterly</option>
                        <option value="yearly" ${compliance.frequency === 'yearly' ? 'selected' : ''}>Yearly</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Deadline Day (1-31)</label>
                    <input type="number" class="form-input" name="deadline_day" min="1" max="31" value="${compliance.deadline_day || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">Deadline Month (1-12)</label>
                    <input type="number" class="form-input" name="deadline_month" min="1" max="12" value="${compliance.deadline_month || ''}">
                </div>
                <div class="form-group">
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" name="manager_only" style="width: auto;" ${compliance.manager_only ? 'checked' : ''}>
                        <span class="form-label" style="margin: 0;">Manager/Admin Only</span>
                    </label>
                    <small style="color: var(--text-muted);">Only managers and admins can update this compliance status</small>
                </div>
                <div class="form-group">
                    <label class="form-label">Instruction Video URL (YouTube)</label>
                    <input type="url" class="form-input" name="instruction_video_url" value="${escapeHtml(compliance.instruction_video_url || '')}" placeholder="e.g., https://youtube.com/watch?v=...">
                </div>
                <div class="form-group">
                    <label class="form-label">Instruction Text</label>
                    <textarea class="form-textarea" name="instruction_text" placeholder="Step-by-step instructions..." rows="4">${escapeHtml(compliance.instruction_text || '')}</textarea>
                </div>
            </form>
        `;

        document.getElementById('modalSubmit').onclick = async () => {
            const form = document.getElementById('complianceForm');
            const data = {
                law_group_id: compliance.law_group_id,
                name: form.name.value,
                description: form.description.value,
                frequency: form.frequency.value,
                deadline_day: form.deadline_day.value ? parseInt(form.deadline_day.value) : null,
                deadline_month: form.deadline_month.value ? parseInt(form.deadline_month.value) : null,
                manager_only: form.manager_only.checked,
                instruction_video_url: form.instruction_video_url.value || null,
                instruction_text: form.instruction_text.value || null
            };

            try {
                await apiCall(`/api/compliances/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                showToast('Compliance updated successfully', 'success');
                closeModal();
                loadLawGroups();
            } catch (error) {
                showToast(error.message, 'error');
            }
        };

        openModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== TEAMS MANAGEMENT =====
async function loadTeams() {
    try {
        const teams = await apiCall('/api/teams');

        document.getElementById('teamsContent').innerHTML = `
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th>Team Name</th>
                        <th>Members</th>
                        <th>Assigned Clients</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${teams.map(t => `
                        <tr>
                            <td><strong>${escapeHtml(t.name)}</strong></td>
                            <td>${t.member_count || 0} members</td>
                            <td>${t.client_count || 0} clients</td>
                            <td>
                                <button class="btn btn-sm btn-secondary" onclick="viewTeam(${t.id})">View</button>
                                <button class="btn btn-sm btn-secondary" onclick="editTeam(${t.id})">Edit</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Failed to load teams', 'error');
    }
}

function showAddTeamModal() {
    document.getElementById('modalTitle').textContent = 'Add Team with Members';
    document.getElementById('modalBody').innerHTML = `
        <form id="teamForm">
            <div class="form-group">
                <label class="form-label">Team Name *</label>
                <input type="text" class="form-input" name="name" placeholder="e.g., Team Alpha" required>
            </div>
            
            <h4 style="margin: 1.5rem 0 0.75rem; color: var(--text-secondary);">Team Members (optional)</h4>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">
                Add team members who can log in with these credentials
            </p>
            
            <div id="membersList">
                <div class="member-row" style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem;">
                    <input type="text" class="form-input member-name" placeholder="Name" style="flex: 1;">
                    <input type="email" class="form-input member-email" placeholder="Email" style="flex: 1;">
                    <input type="password" class="form-input member-password" placeholder="Password" style="flex: 1;">
                </div>
            </div>
            
            <button type="button" class="btn btn-secondary btn-sm" onclick="addMemberRow()" style="margin-top: 0.5rem;">
                + Add Another Member
            </button>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('teamForm');
        const teamName = form.name.value;

        if (!teamName) {
            showToast('Team name is required', 'error');
            return;
        }

        try {
            // First create the team
            const teamRes = await apiCall('/api/teams', {
                method: 'POST',
                body: JSON.stringify({ name: teamName })
            });

            const teamId = teamRes.id;

            // Then create each member
            const memberRows = document.querySelectorAll('.member-row');
            for (const row of memberRows) {
                const name = row.querySelector('.member-name').value.trim();
                const email = row.querySelector('.member-email').value.trim();
                const password = row.querySelector('.member-password').value;

                if (name && email && password) {
                    await apiCall('/api/users', {
                        method: 'POST',
                        body: JSON.stringify({
                            name: name,
                            email: email,
                            password: password,
                            role: 'team_member',
                            team_id: teamId
                        })
                    });
                }
            }

            showToast('Team and members created successfully!', 'success');
            closeModal();
            loadTeams();
            loadInitialData();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}

function addMemberRow() {
    const container = document.getElementById('membersList');
    const row = document.createElement('div');
    row.className = 'member-row';
    row.style = 'display: flex; gap: 0.5rem; margin-bottom: 0.5rem;';
    row.innerHTML = `
        <input type="text" class="form-input member-name" placeholder="Name" style="flex: 1;">
        <input type="email" class="form-input member-email" placeholder="Email" style="flex: 1;">
        <input type="password" class="form-input member-password" placeholder="Password" style="flex: 1;">
        <button type="button" class="btn btn-sm btn-secondary" onclick="this.parentElement.remove()" style="color: var(--urgency-overdue);">×</button>
    `;
    container.appendChild(row);
}


async function viewTeam(id) {
    try {
        const team = await apiCall(`/api/teams/${id}`);

        document.getElementById('modalTitle').textContent = team.name;
        document.getElementById('modalBody').innerHTML = `
            <h4 style="margin-bottom: 0.5rem;">Members (${team.members.length})</h4>
            ${team.members.length === 0 ? '<p style="color: var(--text-muted);">No members yet</p>' :
                `<ul style="margin-bottom: 1rem; padding-left: 1.5rem;">
                ${team.members.map(m => `<li>${escapeHtml(m.name)} (${m.email})</li>`).join('')}
            </ul>`}
            
            <h4 style="margin-bottom: 0.5rem;">Assigned Clients (${team.clients.length})</h4>
            ${team.clients.length === 0 ? '<p style="color: var(--text-muted);">No clients assigned</p>' :
                `<ul style="padding-left: 1.5rem;">
                ${team.clients.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}
            </ul>`}
        `;
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        `;

        openModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function editTeam(id) {
    try {
        const team = await apiCall(`/api/teams/${id}`);

        document.getElementById('modalTitle').textContent = 'Edit Team';
        document.getElementById('modalBody').innerHTML = `
            <form id="teamForm">
                <div class="form-group">
                    <label class="form-label">Team Name *</label>
                    <input type="text" class="form-input" name="name" value="${escapeHtml(team.name)}" required>
                </div>
            </form>
        `;

        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="modalSubmit">Save</button>
        `;

        document.getElementById('modalSubmit').onclick = async () => {
            const form = document.getElementById('teamForm');

            try {
                await apiCall(`/api/teams/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name: form.name.value })
                });
                showToast('Team updated successfully', 'success');
                closeModal();
                loadTeams();
            } catch (error) {
                showToast(error.message, 'error');
            }
        };

        openModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== USERS MANAGEMENT =====
async function loadUsers() {
    try {
        const users = await apiCall('/api/users');

        document.getElementById('usersContent').innerHTML = `
            <table class="matrix-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Team</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr>
                            <td><strong>${escapeHtml(u.name)}</strong></td>
                            <td>${escapeHtml(u.email)}</td>
                            <td><span class="status-badge ${u.role === 'manager' ? 'status-done' : 'status-pending'}">${u.role.replace('_', ' ')}</span></td>
                            <td>${escapeHtml(u.team_name || 'None')}</td>
                            <td>
                                <button class="btn btn-sm btn-secondary" onclick="editUser(${u.id})">Edit</button>
                                ${u.id !== currentUser.id ? `
                                    <button class="btn btn-sm btn-secondary" onclick="deleteUser(${u.id})" style="color: var(--urgency-overdue);">Delete</button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        showToast('Failed to load users', 'error');
    }
}

function showAddUserModal() {
    document.getElementById('modalTitle').textContent = 'Add User';
    document.getElementById('modalBody').innerHTML = `
        <form id="userForm">
            <div class="form-group">
                <label class="form-label">Full Name *</label>
                <input type="text" class="form-input" name="name" required>
            </div>
            <div class="form-group">
                <label class="form-label">Email *</label>
                <input type="email" class="form-input" name="email" required>
            </div>
            <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" name="password" placeholder="Default: password123">
                <small style="color: var(--text-muted);">Leave empty for default password: password123</small>
            </div>
            <div class="form-group">
                <label class="form-label">Role *</label>
                <select class="form-select" name="role" required>
                    <option value="team_member">Team Member</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('userForm');
        const data = {
            name: form.name.value,
            email: form.email.value,
            role: form.role.value
        };
        if (form.password.value) {
            data.password = form.password.value;
        }

        try {
            await apiCall('/api/users', { method: 'POST', body: JSON.stringify(data) });
            showToast('User created successfully', 'success');
            closeModal();
            loadUsers();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}

async function editUser(id) {
    try {
        const users = await apiCall('/api/users');
        const user = users.find(u => u.id === id);

        document.getElementById('modalTitle').textContent = 'Edit User';
        document.getElementById('modalBody').innerHTML = `
            <form id="userForm">
                <div class="form-group">
                    <label class="form-label">Full Name *</label>
                    <input type="text" class="form-input" name="name" value="${escapeHtml(user.name)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">Email *</label>
                    <input type="email" class="form-input" name="email" value="${escapeHtml(user.email)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">New Password (leave blank to keep current)</label>
                    <input type="password" class="form-input" name="password">
                </div>
                <div class="form-group">
                    <label class="form-label">Role *</label>
                    <select class="form-select" name="role" required>
                        <option value="team_member" ${user.role === 'team_member' ? 'selected' : ''}>Team Member</option>
                        <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </div>
            </form>
        `;

        document.getElementById('modalSubmit').onclick = async () => {
            const form = document.getElementById('userForm');
            const data = {
                name: form.name.value,
                email: form.email.value,
                role: form.role.value
            };

            if (form.password.value) {
                data.password = form.password.value;
            }

            try {
                await apiCall(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
                showToast('User updated successfully', 'success');
                closeModal();
                loadUsers();
            } catch (error) {
                showToast(error.message, 'error');
            }
        };

        openModal();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
        await apiCall(`/api/users/${id}`, { method: 'DELETE' });
        showToast('User deleted successfully', 'success');
        loadUsers();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== MONTHLY CLIENT MANAGEMENT =====
async function showManageClientsModal() {
    try {
        const data = await apiCall(`/api/status/monthly-clients?year=${currentYear}&month=${currentMonth}`);

        document.getElementById('modalTitle').textContent = `Manage Clients for ${getMonthName(currentMonth)} ${currentYear}`;
        document.getElementById('modalBody').innerHTML = `
            <p style="margin-bottom: 1rem; color: var(--text-muted);">
                Toggle which clients are included this month and assign teams.
            </p>
            <table class="matrix-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th>Include</th>
                        <th>Client</th>
                        <th>Team</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.clients.map(c => `
                        <tr data-client-id="${c.id}">
                            <td style="text-align: center;">
                                <input type="checkbox" class="client-include-checkbox" 
                                       data-client-id="${c.id}" 
                                       ${c.is_included !== 0 ? 'checked' : ''}>
                            </td>
                            <td>
                                <strong>${escapeHtml(c.name)}</strong>
                                <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(c.industry || '')}</div>
                            </td>
                            <td>
                                <select class="form-select client-team-select" data-client-id="${c.id}" style="padding: 0.4rem;">
                                    <option value="">-- No Team --</option>
                                    ${data.teams.map(t => `
                                        <option value="${t.id}" ${c.team_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>
                                    `).join('')}
                                </select>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        // Set up save button to save all changes
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="saveMonthlyClients()">Save Changes</button>
        `;

        openModal();
    } catch (error) {
        showToast('Failed to load monthly clients: ' + error.message, 'error');
    }
}

async function saveMonthlyClients() {
    const rows = document.querySelectorAll('#modalBody tbody tr');
    const updates = [];

    rows.forEach(row => {
        const clientId = parseInt(row.dataset.clientId);
        const checkbox = row.querySelector('.client-include-checkbox');
        const teamSelect = row.querySelector('.client-team-select');

        updates.push({
            client_id: clientId,
            is_included: checkbox.checked,
            team_id: teamSelect.value ? parseInt(teamSelect.value) : null,
            year: currentYear,
            month: currentMonth
        });
    });

    try {
        // Update each client
        for (const update of updates) {
            await apiCall('/api/status/monthly-clients', {
                method: 'POST',
                body: JSON.stringify(update)
            });
        }

        showToast('Monthly client settings saved!', 'success');
        closeModal();
        loadMatrix(); // Refresh the matrix
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

// ===== MONTH SETUP =====
let setupYear, setupMonth;

async function loadMonthSetup() {
    try {
        // Load extensions data (admin only)
        const extensionData = await apiCall('/api/status/extensions');

        document.getElementById('monthSetupContent').innerHTML = `
            <h2 style="margin-bottom: 1rem;">Compliance Extensions</h2>
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">
                Set extension days for compliances. These extensions become the default deadline for all future months until changed.
            </p>
            
            <!-- Add Temporary Compliance Section -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1.5rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="color: var(--text-secondary);">Add Temporary Compliance</h3>
                    <button class="btn btn-primary btn-sm" onclick="showAddTempComplianceModal()">+ Add Compliance</button>
                </div>
                <p style="font-size: 0.85rem; color: var(--text-muted);">
                    Add a compliance for just this month, or make it permanent.
                </p>
            </div>
            
            <!-- Extensions Section -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1.5rem;">
                <h3 style="margin-bottom: 1rem; color: var(--text-secondary);">Extensions</h3>
                <table class="matrix-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Compliance</th>
                            <th>Law Group</th>
                            <th style="width: 100px;">Default Deadline</th>
                            <th style="width: 120px;">Extension Day</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${extensionData.compliances.map(c => `
                            <tr>
                                <td>${escapeHtml(c.name)}${c.is_temporary ? ' <span style="color: var(--status-pending);">(Temp)</span>' : ''}</td>
                                <td style="color: var(--text-muted);">${escapeHtml(c.law_group_name)}</td>
                                <td style="text-align: center;">${c.default_deadline || '-'}</td>
                                <td>
                                    <input type="number" class="form-input setup-extension-input" 
                                           data-compliance-id="${c.id}" 
                                           min="1" max="31" 
                                           value="${c.extension_day || ''}"
                                           placeholder="${c.default_deadline || 'Day'}"
                                           style="width: 80px; padding: 0.3rem; text-align: center;">
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        document.getElementById('monthSetupContent').innerHTML = `
            <div style="color: var(--urgency-overdue); padding: 2rem; text-align: center;">
                Failed to load: ${error.message}
            </div>
        `;
    }
}

// Show modal to add temporary compliance
function showAddTempComplianceModal() {
    document.getElementById('modalTitle').textContent = 'Add Temporary Compliance';
    document.getElementById('modalBody').innerHTML = `
        <form id="tempComplianceForm">
            <div class="form-group">
                <label class="form-label">Compliance Name *</label>
                <input type="text" class="form-input" name="name" placeholder="e.g., Special Filing" required>
            </div>
            <div class="form-group">
                <label class="form-label">Law Group *</label>
                <select class="form-select" name="law_group_id" required>
                    ${cachedLawGroups.map(lg => `<option value="${lg.id}">${lg.name}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Deadline Day (1-31)</label>
                <input type="number" class="form-input" name="deadline_day" min="1" max="31" placeholder="e.g., 15">
            </div>
            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-textarea" name="description" placeholder="What this compliance involves..."></textarea>
            </div>
            <div class="form-group">
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                    <input type="checkbox" name="is_permanent" style="width: auto;">
                    <span class="form-label" style="margin: 0;">Keep Permanently</span>
                </label>
                <small style="color: var(--text-muted);">If unchecked, this compliance will only appear for ${getMonthName(currentMonth)} ${currentYear}</small>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('tempComplianceForm');
        const isPermanent = form.is_permanent.checked;

        const data = {
            law_group_id: parseInt(form.law_group_id.value),
            name: form.name.value,
            description: form.description.value,
            deadline_day: form.deadline_day.value ? parseInt(form.deadline_day.value) : null,
            frequency: 'monthly',
            is_temporary: isPermanent ? 0 : 1,
            temp_month: isPermanent ? null : currentMonth,
            temp_year: isPermanent ? null : currentYear
        };

        try {
            await apiCall('/api/compliances', { method: 'POST', body: JSON.stringify(data) });
            showToast(isPermanent ? 'Compliance added permanently!' : `Temporary compliance added for ${getMonthName(currentMonth)} ${currentYear}`, 'success');
            closeModal();
            loadMonthSetup();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    openModal();
}


function populateSetupMonthSelector() {
    // No longer needed - extensions apply to all future months
    // Hide the month selector element
    const setupMonthEl = document.getElementById('setupMonth');
    if (setupMonthEl) {
        setupMonthEl.style.display = 'none';
    }
}

async function saveMonthSetup() {
    try {
        // Save extension overrides
        const extensionInputs = document.querySelectorAll('.setup-extension-input');
        for (const input of extensionInputs) {
            const complianceId = parseInt(input.dataset.complianceId);
            const value = input.value.trim();

            await apiCall('/api/status/extensions', {
                method: 'POST',
                body: JSON.stringify({
                    compliance_id: complianceId,
                    extension_day: value ? parseInt(value) : null
                })
            });
        }

        showToast('Extensions saved! They will apply to all future months.', 'success');
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

// ===== DEADLINE MANAGEMENT =====
async function showManageDeadlinesModal() {
    try {
        const data = await apiCall(`/api/status/monthly-deadlines?year=${currentYear}&month=${currentMonth}`);

        document.getElementById('modalTitle').textContent = `Manage Deadlines for ${getMonthName(currentMonth)} ${currentYear}`;
        document.getElementById('modalBody').innerHTML = `
            <p style="margin-bottom: 1rem; color: var(--text-muted);">
                Set custom deadline dates for this month. Leave blank to use default.
            </p>
            <table class="matrix-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th>Compliance</th>
                        <th>Law Group</th>
                        <th>Default</th>
                        <th>Custom Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.compliances.map(c => `
                        <tr>
                            <td>${escapeHtml(c.name)}</td>
                            <td style="color: var(--text-muted);">${escapeHtml(c.law_group_name)}</td>
                            <td style="text-align: center;">${c.default_deadline || '-'}</td>
                            <td>
                                <input type="number" class="form-input deadline-input" 
                                       data-compliance-id="${c.id}" 
                                       min="1" max="31" 
                                       value="${c.custom_deadline_day || ''}"
                                       placeholder="${c.default_deadline || 'Day'}"
                                       style="width: 70px; padding: 0.3rem; text-align: center;">
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="saveMonthlyDeadlines()">Save Changes</button>
        `;

        openModal();
    } catch (error) {
        showToast('Failed to load deadlines: ' + error.message, 'error');
    }
}

async function saveMonthlyDeadlines() {
    const inputs = document.querySelectorAll('.deadline-input');

    try {
        for (const input of inputs) {
            const complianceId = parseInt(input.dataset.complianceId);
            const value = input.value.trim();

            await apiCall('/api/status/monthly-deadlines', {
                method: 'POST',
                body: JSON.stringify({
                    compliance_id: complianceId,
                    year: currentYear,
                    month: currentMonth,
                    custom_deadline_day: value ? parseInt(value) : null
                })
            });
        }

        showToast('Deadlines saved!', 'success');
        closeModal();
        loadMatrix();
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

// ===== MODAL HELPERS =====
function openModal() {
    document.getElementById('modalOverlay').classList.add('active');
    // Reset footer to default if needed
    if (!document.getElementById('modalSubmit')) {
        document.getElementById('modalFooter').innerHTML = `
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="modalSubmit">Save</button>
        `;
    }
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

// Close modal on overlay click
document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) {
        closeModal();
    }
});

// ===== UTILITY FUNCTIONS =====
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getMonthName(month) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[month - 1] || '';
}

// ===== CALENDAR FUNCTIONS =====
async function loadCalendar() {
    try {
        // Populate client filter
        const clients = await apiCall('/api/clients');
        const clientSelect = document.getElementById('calendarClient');
        clientSelect.innerHTML = '<option value="">All Clients</option>' +
            clients.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

        clientSelect.onchange = loadCalendar;

        // Update month label
        document.getElementById('calendarMonthLabel').textContent =
            `${getMonthName(calendarMonth)} ${calendarYear}`;

        const selectedClient = clientSelect.value;
        const calendarUrl = selectedClient
            ? `/api/status/calendar?year=${calendarYear}&month=${calendarMonth}&client_id=${selectedClient}`
            : `/api/status/calendar?year=${calendarYear}&month=${calendarMonth}`;

        const data = await apiCall(calendarUrl);

        // Render calendar grid
        renderCalendarGrid(data.tasksByDay);
    } catch (error) {
        console.error('Calendar load error:', error);
        document.getElementById('calendarContent').innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--urgency-overdue);">
                Failed to load calendar: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderCalendarGrid(tasksByDay) {
    const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
    const firstDay = new Date(calendarYear, calendarMonth - 1, 1).getDay();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === calendarYear && today.getMonth() + 1 === calendarMonth;
    const currentDay = today.getDate();

    let html = '<div class="calendar-grid">';

    // Day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    html += '<div class="calendar-header">';
    dayNames.forEach(d => {
        html += `<div class="calendar-day-name">${d}</div>`;
    });
    html += '</div>';

    html += '<div class="calendar-body">';

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-cell empty"></div>';
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const tasks = tasksByDay[day] || [];
        const pendingTasks = tasks.filter(t => t.status === 'pending');
        const doneTasks = tasks.filter(t => t.status === 'done');
        const isToday = isCurrentMonth && day === currentDay;
        const isPast = isCurrentMonth && day < currentDay;

        let cellClass = 'calendar-cell';
        if (isToday) cellClass += ' today';
        if (isPast && pendingTasks.length > 0) cellClass += ' has-overdue';
        else if (pendingTasks.length > 0) cellClass += ' has-pending';
        else if (doneTasks.length > 0) cellClass += ' has-done';

        html += `<div class="${cellClass}" onclick="showDayTasks(${day}, event)">`;
        html += `<div class="calendar-day-number">${day}</div>`;

        if (tasks.length > 0) {
            html += `<div class="calendar-task-indicator">`;
            if (pendingTasks.length > 0) {
                html += `<span class="pending-count">${pendingTasks.length} pending</span>`;
            }
            if (doneTasks.length > 0) {
                html += `<span class="done-count">${doneTasks.length} done</span>`;
            }
            html += `</div>`;
        }

        html += '</div>';
    }

    html += '</div></div>';

    document.getElementById('calendarContent').innerHTML = html;
}

function showDayTasks(day, event) {
    event.stopPropagation();

    // Highlight selected day
    document.querySelectorAll('.calendar-cell').forEach(c => c.classList.remove('selected'));
    event.target.closest('.calendar-cell').classList.add('selected');

    apiCall(`/api/status/calendar?year=${calendarYear}&month=${calendarMonth}`)
        .then(data => {
            const tasks = data.tasksByDay[day] || [];
            const sidebar = document.getElementById('calendarSidebar');

            const today = new Date();
            const isOverdue = (task) => {
                if (task.status !== 'pending') return false;
                const deadlineDate = new Date(calendarYear, calendarMonth - 1, task.deadline_day);
                return today > deadlineDate;
            };

            if (tasks.length === 0) {
                sidebar.innerHTML = `
                    <div class="calendar-sidebar-header">${day} ${getMonthName(calendarMonth)} ${calendarYear}</div>
                    <div class="calendar-sidebar-empty">No tasks on this day</div>
                `;
                return;
            }

            sidebar.innerHTML = `
                <div class="calendar-sidebar-header">${day} ${getMonthName(calendarMonth)} ${calendarYear} (${tasks.length} tasks)</div>
                ${tasks.map(t => {
                const overdueClass = isOverdue(t) ? 'overdue' : t.status;
                return `
                        <div class="calendar-task-item ${overdueClass}">
                            <div class="calendar-task-client">${escapeHtml(t.client_name)}</div>
                            <div class="calendar-task-name">${escapeHtml(t.compliance_name)} (${escapeHtml(t.law_group_name)})</div>
                            <div class="calendar-task-actions">
                                <select class="status-select status-${t.status}" onchange="updateCalendarStatus(${t.client_id}, ${t.compliance_id}, this.value)">
                                    <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
                                    <option value="na" ${t.status === 'na' ? 'selected' : ''}>N/A</option>
                                </select>
                                ${t.channel_mail && t.status === 'pending' && isOverdue(t) ?
                        `<button class="btn btn-icon" onclick="sendOverdueEmail('${escapeHtml(t.channel_mail)}', '${escapeHtml(t.client_name)}', '${escapeHtml(t.compliance_name)}')" title="Send overdue email">📧</button>`
                        : ''}
                            </div>
                        </div>
                    `;
            }).join('')}
            `;
        });
}

async function updateCalendarStatus(clientId, complianceId, status) {
    try {
        await apiCall('/api/status/update', {
            method: 'POST',
            body: JSON.stringify({
                client_id: clientId,
                compliance_id: complianceId,
                year: calendarYear,
                month: calendarMonth,
                status: status
            })
        });
        showToast('Status updated', 'success');
        loadCalendar();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function prevMonth() {
    // Calculate new month
    let newMonth = calendarMonth - 1;
    let newYear = calendarYear;

    if (newMonth < 1) {
        newMonth = 12;
        newYear--;
    }

    // Prevent going before Jan 2026
    if (newYear < 2026) {
        return;
    }

    calendarMonth = newMonth;
    calendarYear = newYear;
    loadCalendar();
}

function nextMonth() {
    calendarMonth++;
    if (calendarMonth > 12) {
        calendarMonth = 1;
        calendarYear++;
    }
    loadCalendar();
}

// Send overdue email via mailto link
function sendOverdueEmail(channelMail, clientName, complianceName) {
    const subject = encodeURIComponent(`Overdue Compliance: ${complianceName} for ${clientName}`);
    const body = encodeURIComponent(`Dear Team,

This is a reminder that the following compliance is overdue:

Client: ${clientName}
Compliance: ${complianceName}
Period: ${getMonthName(calendarMonth)} ${calendarYear}

Please address this at your earliest convenience.

Best regards`);

    window.open(`mailto:${channelMail}?subject=${subject}&body=${body}`, '_blank');
}

// Show instruction manual modal for a compliance
function showInstructionManual(complianceId, complianceName) {
    apiCall(`/api/compliances/${complianceId}`)
        .then(compliance => {
            let content = '';

            if (compliance.instruction_video_url) {
                // Convert YouTube URL to embed format
                let videoUrl = compliance.instruction_video_url;
                if (videoUrl.includes('youtube.com/watch')) {
                    const videoId = videoUrl.split('v=')[1]?.split('&')[0];
                    videoUrl = `https://www.youtube.com/embed/${videoId}`;
                } else if (videoUrl.includes('youtu.be/')) {
                    const videoId = videoUrl.split('youtu.be/')[1]?.split('?')[0];
                    videoUrl = `https://www.youtube.com/embed/${videoId}`;
                }

                content += `
                    <div class="instruction-video-container">
                        <iframe src="${videoUrl}" frameborder="0" allowfullscreen></iframe>
                    </div>
                `;
            }

            if (compliance.instruction_text) {
                content += `<div class="instruction-text">${escapeHtml(compliance.instruction_text)}</div>`;
            }

            if (!compliance.instruction_video_url && !compliance.instruction_text) {
                content = '<p style="color: var(--text-muted);">No instructions available for this compliance.</p>';
            }

            document.getElementById('modalTitle').textContent = `Instructions: ${complianceName}`;
            document.getElementById('modalBody').innerHTML = content;
            document.getElementById('modalSubmit').style.display = 'none';
            openModal();
        })
        .catch(err => {
            showToast('Failed to load instructions: ' + err.message, 'error');
        });
}

// Show compliance instructions in matrix sidebar
function showComplianceInstructions(complianceId, complianceName) {
    const sidebar = document.getElementById('matrixSidebar');

    sidebar.innerHTML = `
        <div class="calendar-sidebar-header">Loading...</div>
    `;

    apiCall(`/api/compliances/${complianceId}`)
        .then(compliance => {
            let content = `<div class="calendar-sidebar-header">${escapeHtml(complianceName)}</div>`;

            if (compliance.instruction_video_url) {
                // Convert YouTube URL to embed format
                let videoUrl = compliance.instruction_video_url;
                if (videoUrl.includes('youtube.com/watch')) {
                    const videoId = videoUrl.split('v=')[1]?.split('&')[0];
                    videoUrl = `https://www.youtube.com/embed/${videoId}`;
                } else if (videoUrl.includes('youtu.be/')) {
                    const videoId = videoUrl.split('youtu.be/')[1]?.split('?')[0];
                    videoUrl = `https://www.youtube.com/embed/${videoId}`;
                }

                content += `
                    <div class="instruction-video-container" style="margin-bottom: 1rem;">
                        <iframe src="${videoUrl}" frameborder="0" allowfullscreen></iframe>
                    </div>
                `;
            }

            if (compliance.instruction_text) {
                content += `<div class="instruction-text">${escapeHtml(compliance.instruction_text)}</div>`;
            }

            if (!compliance.instruction_video_url && !compliance.instruction_text) {
                content += '<div class="calendar-sidebar-empty">No instructions available for this compliance.</div>';
            }

            // Add close button and deadline info
            content += `
                <div style="margin-top: 1rem; padding-top: 0.5rem; border-top: 1px solid var(--border-color); font-size: 0.85rem; color: var(--text-muted);">
                    <strong>Deadline:</strong> Day ${compliance.deadline_day || 'Not set'}
                    ${compliance.deadline_month ? ` / Month ${compliance.deadline_month}` : ''}
                    <br>
                    <strong>Frequency:</strong> ${compliance.frequency}
                </div>
            `;

            sidebar.innerHTML = content;
        })
        .catch(err => {
            sidebar.innerHTML = `
                <div class="calendar-sidebar-header">${escapeHtml(complianceName)}</div>
                <div class="calendar-sidebar-empty" style="color: var(--urgency-overdue);">Failed to load: ${escapeHtml(err.message)}</div>
            `;
        });
}

// ===== ONEDRIVE LINKS =====
function showOneDriveModal(clientId, clientName) {
    apiCall(`/api/status/client-link?client_id=${clientId}&history=true`)
        .then(data => {
            const links = data.links || [];
            const currentLink = links.find(l => l.period_year === currentYear && l.period_month === currentMonth);

            document.getElementById('modalTitle').textContent = `OneDrive Link: ${clientName}`;
            document.getElementById('modalBody').innerHTML = `
                <form id="oneDriveForm">
                    <div class="form-group">
                        <label class="form-label">OneDrive Link for ${getMonthName(currentMonth)} ${currentYear}</label>
                        <input type="url" class="form-input" name="onedrive_link" 
                               value="${escapeHtml(currentLink?.onedrive_link || '')}"
                               placeholder="Paste OneDrive folder link here...">
                    </div>
                    ${links.length > 0 ? `
                        <div class="form-group">
                            <label class="form-label">Previous Links</label>
                            <div style="max-height: 200px; overflow-y: auto;">
                                ${links.map(l => `
                                    <div style="padding: 0.5rem; border-bottom: 1px solid var(--border-color);">
                                        <strong>${getMonthName(l.period_month)} ${l.period_year}</strong>: 
                                        <a href="${escapeHtml(l.onedrive_link)}" target="_blank" style="color: var(--status-done);">Open Link</a>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </form>
            `;

            document.getElementById('modalSubmit').style.display = '';
            document.getElementById('modalSubmit').onclick = async () => {
                const form = document.getElementById('oneDriveForm');
                try {
                    await apiCall('/api/status/client-link', {
                        method: 'POST',
                        body: JSON.stringify({
                            client_id: clientId,
                            year: currentYear,
                            month: currentMonth,
                            onedrive_link: form.onedrive_link.value
                        })
                    });
                    showToast('OneDrive link saved', 'success');
                    closeModal();
                    loadMatrix();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            };
            openModal();
        });
}

// ===== MONTH LOCKING =====
async function checkMonthLock() {
    try {
        const lockStatus = await apiCall(`/api/status/month-lock?year=${currentYear}&month=${currentMonth}`);
        return lockStatus;
    } catch (e) {
        return { locked: false };
    }
}

function showUnlockMonthModal() {
    document.getElementById('modalTitle').textContent = `Unlock ${getMonthName(currentMonth)} ${currentYear}`;
    document.getElementById('modalBody').innerHTML = `
        <form id="unlockForm">
            <div class="form-group">
                <label class="form-label">Unlock Duration (hours)</label>
                <select class="form-select" name="duration">
                    <option value="1">1 hour</option>
                    <option value="4">4 hours</option>
                    <option value="8">8 hours</option>
                    <option value="24" selected>24 hours</option>
                    <option value="48">48 hours</option>
                </select>
            </div>
            <p style="color: var(--text-muted); font-size: 0.85rem;">
                This will temporarily unlock the month for editing. The lock will automatically re-engage after the specified duration.
            </p>
        </form>
    `;

    document.getElementById('modalSubmit').style.display = '';
    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('unlockForm');
        try {
            await apiCall('/api/status/unlock-month', {
                method: 'POST',
                body: JSON.stringify({
                    year: currentYear,
                    month: currentMonth,
                    duration_hours: parseInt(form.duration.value)
                })
            });
            showToast(`Month unlocked for ${form.duration.value} hours`, 'success');
            closeModal();
            loadMatrix();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    openModal();
}

// ===== CLIENT INSIGHTS =====
let insightsChart = null;

// Load insights section in dashboard
async function loadDashboardInsights() {
    const section = document.getElementById('dashboardInsightsSection');
    if (!section) return;

    section.style.display = 'block';

    try {
        const clients = await apiCall('/api/insights/clients-with-domains');
        const select = document.getElementById('dashboardInsightsClient');
        select.innerHTML = '<option value="">Select a client...</option>' +
            clients.map(c => `<option value="${c.id}">${c.name}${c.email_domain ? ` (${c.email_domain})` : ''}</option>`).join('');

        select.onchange = () => {
            const clientId = select.value;
            if (clientId) {
                loadDashboardClientInsights(clientId);
            } else {
                document.getElementById('dashboardInsightsContent').innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        Select a client to view sentiment & compliance correlation
                    </div>
                `;
            }
        };
    } catch (error) {
        console.error('Load dashboard insights error:', error);
    }
}

async function loadDashboardClientInsights(clientId) {
    const container = document.getElementById('dashboardInsightsContent');
    container.innerHTML = '<div style="text-align: center; padding: 2rem;"><div class="loading-spinner"></div></div>';

    try {
        // Fetch both sentiment and compliance data in parallel
        const [sentimentData, complianceData] = await Promise.all([
            apiCall(`/api/insights/sentiment/${clientId}`),
            apiCall(`/api/insights/compliance/${clientId}`)
        ]);

        if (!sentimentData.hasData) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    <p>${escapeHtml(sentimentData.message || 'No email data available for this client')}</p>
                    <p style="font-size: 0.85rem;">Make sure the client has an email domain configured and the sentiment database is connected.</p>
                </div>
            `;
            return;
        }

        // Store daily data globally for drill-down
        window.emailSentimentData = sentimentData.sentiment;
        window.emailDomain = sentimentData.domain;

        // Aggregate by month
        const monthlyData = aggregateByMonth(sentimentData.sentiment);

        // Calculate totals
        const totalEmails = sentimentData.sentiment.reduce((sum, d) => sum + parseInt(d.total_emails), 0);
        const totalNegative = sentimentData.sentiment.reduce((sum, d) => sum + parseInt(d.negative_count), 0);
        const totalNeutral = sentimentData.sentiment.reduce((sum, d) => sum + parseInt(d.neutral_count || 0), 0);
        const totalPositive = sentimentData.sentiment.reduce((sum, d) => sum + parseInt(d.positive_count || 0), 0);

        // Calculate risk score (0-100)
        // Weighted: 50% deadline risk + 50% negative sentiment
        const negativePercent = totalEmails > 0 ? (totalNegative / totalEmails) * 100 : 0;
        const pendingPercent = complianceData.total > 0 ? (complianceData.pending / complianceData.total) * 100 : 0;
        const riskScore = Math.round((pendingPercent * 0.5) + (negativePercent * 0.5));

        // Risk level color
        let riskColor = '#22c55e'; // Green - Low
        let riskLabel = 'Low';
        if (riskScore > 60) { riskColor = '#ef4444'; riskLabel = 'High'; }
        else if (riskScore > 30) { riskColor = '#fbbf24'; riskLabel = 'Medium'; }

        container.innerHTML = `
            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
                <div style="background: var(--bg-secondary); border-radius: 8px; padding: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <h4 id="chartTitle">📧 Email Activity - ${sentimentData.domain} (Monthly)</h4>
                        <button id="backToMonthlyBtn" class="btn btn-sm btn-secondary" style="display: none;" onclick="showMonthlyChart()">
                            ← Back to Monthly
                        </button>
                    </div>
                    <p id="chartSubtitle" style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">Click on a month to see daily breakdown</p>
                    <div style="height: 280px;">
                        <canvas id="dashboardEmailChart"></canvas>
                    </div>
                </div>
                <div style="background: var(--bg-secondary); border-radius: 8px; padding: 1rem;">
                    <h4 style="margin-bottom: 0.75rem;">Client Summary</h4>
                    <div style="display: grid; gap: 0.5rem;">
                        <!-- Risk Score -->
                        <div style="padding: 0.75rem; background: linear-gradient(135deg, ${riskColor}22, ${riskColor}11); border: 1px solid ${riskColor}44; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 0.85rem; font-weight: 500;">⚠️ Risk Score</span>
                                <span style="font-size: 1.5rem; font-weight: 700; color: ${riskColor};">${riskScore}</span>
                            </div>
                            <div style="font-size: 0.75rem; color: ${riskColor}; font-weight: 500;">${riskLabel} Risk</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem;">
                                Pending: ${pendingPercent.toFixed(0)}% | Neg: ${negativePercent.toFixed(0)}%
                            </div>
                        </div>
                        <!-- Stats grid -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                            <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; text-align: center;">
                                <div style="font-size: 1.1rem; font-weight: 600;">${totalEmails}</div>
                                <div style="color: var(--text-muted); font-size: 0.7rem;">Emails</div>
                            </div>
                            <div style="padding: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; text-align: center;">
                                <div style="font-size: 1.1rem; font-weight: 600;">${complianceData.pending}/${complianceData.total}</div>
                                <div style="color: var(--text-muted); font-size: 0.7rem;">Pending</div>
                            </div>
                            <div style="padding: 0.5rem; background: rgba(239, 68, 68, 0.1); border-radius: 4px; text-align: center;">
                                <div style="font-size: 1rem; font-weight: 600; color: #ef4444;">${totalNegative}</div>
                                <div style="color: var(--text-muted); font-size: 0.65rem;">Negative</div>
                            </div>
                            <div style="padding: 0.5rem; background: rgba(34, 197, 94, 0.1); border-radius: 4px; text-align: center;">
                                <div style="font-size: 1rem; font-weight: 600; color: #22c55e;">${totalPositive}</div>
                                <div style="color: var(--text-muted); font-size: 0.65rem;">Positive</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;


        // Store monthly data globally
        window.monthlyEmailData = monthlyData;

        // Render the monthly chart
        renderMonthlyEmailChart(monthlyData);
    } catch (error) {
        container.innerHTML = `<div style="color: var(--urgency-overdue);">Failed to load: ${escapeHtml(error.message)}</div>`;
    }
}

// Aggregate daily data into monthly totals
function aggregateByMonth(dailyData) {
    const monthly = {};

    dailyData.forEach(d => {
        const date = new Date(d.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        if (!monthly[key]) {
            monthly[key] = {
                key,
                label,
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                total_emails: 0,
                negative_count: 0,
                neutral_count: 0,
                positive_count: 0,
                prob_sum: 0,
                prob_count: 0
            };
        }

        monthly[key].total_emails += parseInt(d.total_emails);
        monthly[key].negative_count += parseInt(d.negative_count);
        monthly[key].neutral_count += parseInt(d.neutral_count || 0);
        monthly[key].positive_count += parseInt(d.positive_count || 0);
        if (d.avg_negative_prob) {
            monthly[key].prob_sum += parseFloat(d.avg_negative_prob) * parseInt(d.total_emails);
            monthly[key].prob_count += parseInt(d.total_emails);
        }
    });

    // Calculate averages and dominant sentiment
    return Object.values(monthly).map(m => {
        const avgProb = m.prob_count > 0 ? m.prob_sum / m.prob_count : 0.5;
        // Determine dominant sentiment
        const max = Math.max(m.negative_count, m.neutral_count, m.positive_count);
        let sentiment = 'Neutral';
        if (m.negative_count === max) sentiment = 'Negative';
        else if (m.positive_count === max) sentiment = 'Positive';

        return { ...m, avg_prob: avgProb, dominant_sentiment: sentiment };
    }).sort((a, b) => a.key.localeCompare(b.key));
}


let emailChart = null;

function renderMonthlyEmailChart(monthlyData) {
    const ctx = document.getElementById('dashboardEmailChart');
    if (!ctx) return;

    // Destroy existing chart
    if (emailChart) {
        emailChart.destroy();
    }

    const labels = monthlyData.map(d => d.label);
    const totalEmails = monthlyData.map(d => d.total_emails);

    // Color points based on dominant sentiment
    const sentimentColors = {
        'Negative': '#ef4444',
        'Neutral': '#fbbf24',
        'Positive': '#22c55e'
    };
    const pointColors = monthlyData.map(d => sentimentColors[d.dominant_sentiment]);

    emailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Emails',
                    data: totalEmails,
                    borderColor: '#888888',
                    backgroundColor: 'rgba(136, 136, 136, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 10,
                    pointHoverRadius: 14,
                    pointBackgroundColor: pointColors,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const monthData = window.monthlyEmailData[index];
                    showDailyChartForMonth(monthData.year, monthData.month, monthData.label);
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const data = monthlyData[context.dataIndex];
                            return [
                                `Emails: ${context.parsed.y}`,
                                `Sentiment: ${data.dominant_sentiment}`,
                                `🔴 Neg: ${data.negative_count} | 🟡 Neu: ${data.neutral_count} | 🟢 Pos: ${data.positive_count}`
                            ];
                        },
                        footer: () => 'Click to see daily breakdown'
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: { font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Emails',
                        font: { size: 10 }
                    },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}


function showDailyChartForMonth(year, month, monthLabel) {
    // Filter daily data for the selected month
    const dailyData = window.emailSentimentData.filter(d => {
        const date = new Date(d.date);
        return date.getFullYear() === year && date.getMonth() + 1 === month;
    });

    if (dailyData.length === 0) {
        showToast('No daily data for this month', 'error');
        return;
    }

    // Update UI
    document.getElementById('chartTitle').textContent = `📧 ${monthLabel} Daily Breakdown`;
    document.getElementById('chartSubtitle').textContent = 'Daily email counts for ' + monthLabel;
    document.getElementById('backToMonthlyBtn').style.display = 'inline-block';

    // Render daily chart
    renderDailyEmailChart(dailyData);
}

function showMonthlyChart() {
    document.getElementById('chartTitle').textContent = `📧 Email Activity - ${window.emailDomain} (Monthly)`;
    document.getElementById('chartSubtitle').textContent = 'Click on a month to see daily breakdown';
    document.getElementById('backToMonthlyBtn').style.display = 'none';

    renderMonthlyEmailChart(window.monthlyEmailData);
}

function renderDailyEmailChart(dailyData) {
    const ctx = document.getElementById('dashboardEmailChart');
    if (!ctx) return;

    if (emailChart) {
        emailChart.destroy();
    }

    const labels = dailyData.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const totalEmails = dailyData.map(d => parseInt(d.total_emails));

    // Determine dominant sentiment for each day and color points
    const sentimentColors = {
        'Negative': '#ef4444',
        'Neutral': '#fbbf24',
        'Positive': '#22c55e'
    };
    const pointColors = dailyData.map(d => {
        const neg = parseInt(d.negative_count);
        const neu = parseInt(d.neutral_count || 0);
        const pos = parseInt(d.positive_count || 0);
        const max = Math.max(neg, neu, pos);
        if (neg === max) return sentimentColors['Negative'];
        if (pos === max) return sentimentColors['Positive'];
        return sentimentColors['Neutral'];
    });

    emailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Emails',
                    data: totalEmails,
                    borderColor: '#888888',
                    backgroundColor: 'rgba(136, 136, 136, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 8,
                    pointHoverRadius: 12,
                    pointBackgroundColor: pointColors,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const data = dailyData[context.dataIndex];
                            const neg = parseInt(data.negative_count);
                            const neu = parseInt(data.neutral_count || 0);
                            const pos = parseInt(data.positive_count || 0);
                            return [
                                `Emails: ${context.parsed.y}`,
                                `🔴 Neg: ${neg} | 🟡 Neu: ${neu} | 🟢 Pos: ${pos}`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: { font: { size: 9 }, maxRotation: 45 }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Emails', font: { size: 10 } },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
}


// Legacy function for correlation chart (kept for insights page)
function renderDashboardChart(data) {
    const ctx = document.getElementById('dashboardCorrelationChart');
    if (!ctx) return;

    const labels = data.months.map(m => m.label);
    const completionRates = data.months.map(m => parseFloat(m.compliance.completionRate) || 0);
    // Use 0 as fallback when no sentiment data available
    const negativeRates = data.months.map(m => m.sentiment ? parseFloat(m.sentiment.negativeRate) : 0);
    const totalEmails = data.months.reduce((sum, m) => sum + (m.sentiment ? m.sentiment.totalEmails : 0), 0);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completion %',
                    data: completionRates,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    borderWidth: 2,
                    spanGaps: true
                },
                {
                    label: totalEmails > 0 ? 'Negative %' : 'Negative % (No email data)',
                    data: negativeRates,
                    borderColor: totalEmails > 0 ? '#ef4444' : '#666666',
                    backgroundColor: totalEmails > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(102, 102, 102, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    borderWidth: 2,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { display: true, ticks: { font: { size: 10 } } },
                y: { min: 0, max: 100, ticks: { font: { size: 10 } } }
            }
        }
    });
}


async function loadInsights() {
    try {
        // Load clients with domains for the selector
        const clients = await apiCall('/api/insights/clients-with-domains');

        const select = document.getElementById('insightsClient');
        select.innerHTML = '<option value="">Select a client...</option>' +
            clients.map(c => `<option value="${c.id}" data-domain="${c.email_domain || ''}">${c.name}${c.email_domain ? ` (${c.email_domain})` : ' - No domain set'}</option>`).join('');

        // Setup change listener
        select.onchange = () => {
            const clientId = select.value;
            if (clientId) {
                loadClientInsights(clientId);
            } else {
                document.getElementById('insightsContent').innerHTML = `
                    <div class="insights-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64" style="opacity: 0.3;">
                            <path d="M3 3v18h18"></path>
                            <path d="M18 9l-5 5-4-4-3 3"></path>
                        </svg>
                        <h3 style="margin-top: 1rem; color: #666;">Select a client to view insights</h3>
                        <p style="color: #999;">Correlate email sentiment with compliance status</p>
                    </div>
                `;
            }
        };
    } catch (error) {
        console.error('Load insights error:', error);
        showToast('Failed to load insights data', 'error');
    }
}

async function loadClientInsights(clientId) {
    try {
        document.getElementById('insightsContent').innerHTML = `
            <div style="text-align: center; padding: 3rem;">
                <div class="loading-spinner" style="width: 40px; height: 40px;"></div>
                <p style="margin-top: 1rem; color: var(--text-muted);">Loading insights...</p>
            </div>
        `;

        const data = await apiCall(`/api/insights/correlation/${clientId}`);

        let html = `
            <div style="margin-bottom: 2rem;">
                <h2 style="margin-bottom: 0.5rem;">${escapeHtml(data.client)}</h2>
                <p style="color: var(--text-muted);">
                    ${data.domain ? `Email Domain: <strong>${escapeHtml(data.domain)}</strong>` : '<em>No email domain configured - only compliance data shown</em>'}
                </p>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 2rem;">
                <div style="background: var(--bg-secondary); border-radius: 8px; padding: 1.5rem;">
                    <h3 style="margin-bottom: 1rem;">📈 Sentiment & Compliance Correlation</h3>
                    <div style="position: relative; height: 400px;">
                        <canvas id="correlationChart"></canvas>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 1rem;">
                        Click on a 30-day marker to drill down. Negative sentiment (red) vs Completion rate (green).
                    </p>
                </div>

                <div style="background: var(--bg-secondary); border-radius: 8px; padding: 1.5rem;">
                    <h3 style="margin-bottom: 1rem;">📊 Monthly Summary</h3>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table class="matrix-table" style="font-size: 0.85rem;">
                            <thead>
                                <tr>
                                    <th>Month</th>
                                    <th>Completed</th>
                                    <th>Pending</th>
                                    <th>Emails</th>
                                    <th>Neg %</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.months.map(m => `
                                    <tr>
                                        <td style="font-weight: 500;">${m.label}</td>
                                        <td style="color: var(--status-done);">${m.compliance.completed}</td>
                                        <td style="color: ${m.compliance.pending > 0 ? 'var(--urgency-warning)' : 'inherit'};">${m.compliance.pending}</td>
                                        <td>${m.sentiment ? m.sentiment.totalEmails : '-'}</td>
                                        <td style="color: ${m.sentiment && parseFloat(m.sentiment.negativeRate) > 20 ? 'var(--urgency-overdue)' : 'inherit'};">
                                            ${m.sentiment ? m.sentiment.negativeRate + '%' : '-'}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            ${data.sentimentError ? `
                <div style="margin-top: 1rem; padding: 1rem; background: #fff3cd; border-radius: 8px; color: #856404;">
                    ⚠️ ${escapeHtml(data.sentimentError)}
                </div>
            ` : ''}
        `;

        document.getElementById('insightsContent').innerHTML = html;

        // Render the correlation chart
        renderCorrelationChart(data);

    } catch (error) {
        console.error('Load client insights error:', error);
        document.getElementById('insightsContent').innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--urgency-overdue);">
                Failed to load insights: ${escapeHtml(error.message)}
            </div>
        `;
    }
}

function renderCorrelationChart(data) {
    const ctx = document.getElementById('correlationChart');
    if (!ctx) return;

    // Destroy existing chart
    if (insightsChart) {
        insightsChart.destroy();
    }

    const labels = data.months.map(m => m.label);
    const completionRates = data.months.map(m => parseFloat(m.compliance.completionRate) || 0);
    const negativeRates = data.months.map(m => m.sentiment ? parseFloat(m.sentiment.negativeRate) : null);
    const pendingCounts = data.months.map(m => m.compliance.pending);

    // Create 30-day interval annotations
    const annotations = {};
    labels.forEach((label, index) => {
        // Add vertical line at each month (30-day intervals)
        annotations[`line${index}`] = {
            type: 'line',
            xMin: index,
            xMax: index,
            borderColor: 'rgba(128, 128, 128, 0.3)',
            borderWidth: 1,
            borderDash: [5, 5],
            label: {
                display: index % 3 === 0, // Show label every 3 months
                content: label,
                position: 'start'
            }
        };
    });

    insightsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completion Rate %',
                    data: completionRates,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Negative Sentiment %',
                    data: negativeRates,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Pending Tasks',
                    data: pendingCounts,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    type: 'bar',
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const monthData = data.months[index];
                    showMonthDetail(monthData);
                }
            },
            plugins: {
                annotation: {
                    annotations: annotations
                },
                tooltip: {
                    callbacks: {
                        afterBody: (context) => {
                            const index = context[0].dataIndex;
                            const month = data.months[index];
                            return [
                                '',
                                `Total Tasks: ${month.compliance.total}`,
                                `Completed: ${month.compliance.completed}`,
                                month.sentiment ? `Total Emails: ${month.sentiment.totalEmails}` : 'No email data'
                            ];
                        }
                    }
                },
                legend: {
                    position: 'top'
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Percentage (%)'
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    min: 0,
                    title: {
                        display: true,
                        text: 'Pending Count'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        }
    });
}

function showMonthDetail(monthData) {
    document.getElementById('modalTitle').textContent = `Details: ${monthData.label}`;
    document.getElementById('modalBody').innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
            <div>
                <h4 style="margin-bottom: 1rem; color: var(--status-done);">📋 Compliance</h4>
                <table class="matrix-table" style="font-size: 0.9rem;">
                    <tr><td>Completed</td><td><strong>${monthData.compliance.completed}</strong></td></tr>
                    <tr><td>Pending</td><td><strong>${monthData.compliance.pending}</strong></td></tr>
                    <tr><td>Total</td><td><strong>${monthData.compliance.total}</strong></td></tr>
                    <tr><td>Completion Rate</td><td><strong>${monthData.compliance.completionRate}%</strong></td></tr>
                </table>
            </div>
            <div>
                <h4 style="margin-bottom: 1rem; color: var(--urgency-overdue);">📧 Email Sentiment</h4>
                ${monthData.sentiment ? `
                    <table class="matrix-table" style="font-size: 0.9rem;">
                        <tr><td>Total Emails</td><td><strong>${monthData.sentiment.totalEmails}</strong></td></tr>
                        <tr><td>Negative Emails</td><td><strong>${monthData.sentiment.negativeCount}</strong></td></tr>
                        <tr><td>Negative Rate</td><td><strong>${monthData.sentiment.negativeRate}%</strong></td></tr>
                        <tr><td>Avg Neg Prob</td><td><strong>${monthData.sentiment.avgNegativeProb}%</strong></td></tr>
                    </table>
                ` : '<p style="color: var(--text-muted);">No email sentiment data available</p>'}
            </div>
        </div>
    `;
    document.getElementById('modalFooter').innerHTML = `
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    `;
    openModal();
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

