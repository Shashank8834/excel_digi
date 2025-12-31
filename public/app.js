// ===== GLOBAL STATE =====
let currentUser = null;
let currentPage = 'dashboard';
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let cachedLawGroups = [];
let cachedTeams = [];

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

    // Show admin section for managers
    if (currentUser.role === 'manager') {
        document.querySelectorAll('.manager-only').forEach(el => el.style.display = 'block');
    }

    // Setup navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });

    // Setup month selectors
    populateMonthSelectors();
}

function populateMonthSelectors() {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const options = [];
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;

    // Current month and next 2 months only (fresh start)
    for (let i = 0; i <= 2; i++) {
        let month = nowMonth + i;
        let year = nowYear;
        if (month > 12) {
            month -= 12;
            year += 1;
        }
        const selected = i === 0 ? 'selected' : '';
        const label = i === 0 ? '(Current)' : i === 1 ? '(Next month)' : '(+2 months)';
        options.push(`<option value="${year}-${month}" ${selected}>${months[month - 1]} ${year} ${label}</option>`);
    }

    const optionsHTML = options.join('');

    document.getElementById('dashboardMonth').innerHTML = optionsHTML;
    document.getElementById('matrixMonth').innerHTML = optionsHTML;

    // Add change listeners
    document.getElementById('dashboardMonth').addEventListener('change', (e) => {
        const [year, month] = e.target.value.split('-');
        currentYear = parseInt(year);
        currentMonth = parseInt(month);
        loadDashboard();
    });

    document.getElementById('matrixMonth').addEventListener('change', (e) => {
        const [year, month] = e.target.value.split('-');
        currentYear = parseInt(year);
        currentMonth = parseInt(month);
        loadMatrix();
    });

    // Matrix filters
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

        // Load teams for admin
        if (currentUser.role === 'manager') {
            const teamsRes = await apiCall('/api/teams');
            cachedTeams = teamsRes;
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
        case 'deadlines':
            loadDeadlines();
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
        case 'teams':
            loadTeams();
            break;
        case 'users':
            loadUsers();
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
        const isEditable = currentYear > now.getFullYear() ||
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
                            <th class="compliance-header">
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
                        <span class="client-name">${escapeHtml(row.client.name)}</span>
                        <span class="client-industry">${escapeHtml(row.client.industry || '')}</span>
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

                if (isEditable) {
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
                } else {
                    html += `
                        <td class="status-cell ${urgencyClass}" title="Past months are read-only">
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

        // Add read-only notice for past months
        if (!isEditable) {
            html = `<div style="background: rgba(245, 158, 11, 0.1); border: 1px solid var(--status-pending); 
                    border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.9rem;">
                    ⚠️ This is a past month. Data is read-only.
                </div>` + html;
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
                        <th>Assigned Teams</th>
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
                            <td>${escapeHtml(c.assigned_teams || 'None')}</td>
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
                <label class="form-label">Assign to Teams</label>
                <select class="form-select" name="team_ids" multiple style="height: 100px;">
                    ${cachedTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
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
            notes: form.notes.value,
            team_ids: Array.from(form.team_ids.selectedOptions).map(o => parseInt(o.value)),
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
                    <label class="form-label">Assign to Teams</label>
                    <select class="form-select" name="team_ids" multiple style="height: 100px;">
                        ${cachedTeams.map(t => `<option value="${t.id}" ${client.team_ids && client.team_ids.includes(t.id) ? 'selected' : ''}>${t.name}</option>`).join('')}
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
                notes: form.notes.value,
                team_ids: Array.from(form.team_ids.selectedOptions).map(o => parseInt(o.value)),
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
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('lawGroupForm');
        const data = {
            name: form.name.value,
            description: form.description.value,
            display_order: parseInt(form.display_order.value) || 0
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
            deadline_month: form.deadline_month.value ? parseInt(form.deadline_month.value) : null
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
                deadline_month: form.deadline_month.value ? parseInt(form.deadline_month.value) : null
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
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Assign to Team</label>
                <select class="form-select" name="team_id">
                    <option value="">No Team</option>
                    ${cachedTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                </select>
            </div>
        </form>
    `;

    document.getElementById('modalSubmit').onclick = async () => {
        const form = document.getElementById('userForm');
        const data = {
            name: form.name.value,
            email: form.email.value,
            role: form.role.value,
            team_id: form.team_id.value ? parseInt(form.team_id.value) : null
        };
        // Only include password if provided
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
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Assign to Team</label>
                    <select class="form-select" name="team_id">
                        <option value="">No Team</option>
                        ${cachedTeams.map(t => `<option value="${t.id}" ${user.team_id === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                </div>
            </form>
        `;

        document.getElementById('modalSubmit').onclick = async () => {
            const form = document.getElementById('userForm');
            const data = {
                name: form.name.value,
                email: form.email.value,
                role: form.role.value,
                team_id: form.team_id.value ? parseInt(form.team_id.value) : null
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
    // Populate month selector if not done
    const setupMonthEl = document.getElementById('setupMonth');
    if (setupMonthEl.options.length === 0) {
        populateSetupMonthSelector();
    }

    // Get selected month from selector
    const value = setupMonthEl.value;
    if (value) {
        [setupYear, setupMonth] = value.split('-').map(Number);
    } else {
        const now = new Date();
        setupYear = now.getFullYear();
        setupMonth = now.getMonth() + 1;
    }

    try {
        // Load clients with their monthly settings
        const clientData = await apiCall(`/api/status/monthly-clients?year=${setupYear}&month=${setupMonth}`);
        // Load deadlines for this month
        const deadlineData = await apiCall(`/api/status/monthly-deadlines?year=${setupYear}&month=${setupMonth}`);

        document.getElementById('monthSetupContent').innerHTML = `
            <h2 style="margin-bottom: 1rem;">Setup for ${getMonthName(setupMonth)} ${setupYear}</h2>
            
            <!-- Clients Section -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1.5rem; margin-bottom: 1.5rem;">
                <h3 style="margin-bottom: 1rem; color: var(--text-secondary);">Clients & Team Assignments</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Select which clients are included this month and assign them to teams.
                </p>
                <table class="matrix-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th style="width: 60px;">Include</th>
                            <th>Client</th>
                            <th style="width: 200px;">Assign to Team</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${clientData.clients.map(c => `
                            <tr data-client-id="${c.id}">
                                <td style="text-align: center;">
                                    <input type="checkbox" class="setup-client-checkbox" 
                                           data-client-id="${c.id}" 
                                           ${c.is_included !== 0 ? 'checked' : ''}>
                                </td>
                                <td>
                                    <strong>${escapeHtml(c.name)}</strong>
                                    <span style="color: var(--text-muted); margin-left: 0.5rem;">${escapeHtml(c.industry || '')}</span>
                                </td>
                                <td>
                                    <select class="form-select setup-team-select" data-client-id="${c.id}">
                                        <option value="">-- No Team --</option>
                                        ${clientData.teams.map(t => `
                                            <option value="${t.id}" ${c.team_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>
                                        `).join('')}
                                    </select>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <!-- Deadlines Section -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 1.5rem;">
                <h3 style="margin-bottom: 1rem; color: var(--text-secondary);">Custom Deadlines</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Set custom deadline dates for this month. Leave blank to use the default deadline.
                </p>
                <table class="matrix-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Compliance</th>
                            <th>Law Group</th>
                            <th style="width: 100px;">Default</th>
                            <th style="width: 120px;">Custom Day</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${deadlineData.compliances.map(c => `
                            <tr>
                                <td>${escapeHtml(c.name)}</td>
                                <td style="color: var(--text-muted);">${escapeHtml(c.law_group_name)}</td>
                                <td style="text-align: center;">${c.default_deadline || '-'}</td>
                                <td>
                                    <input type="number" class="form-input setup-deadline-input" 
                                           data-compliance-id="${c.id}" 
                                           min="1" max="31" 
                                           value="${c.custom_deadline_day || ''}"
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

function populateSetupMonthSelector() {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;

    const options = [];
    // Current month and next 6 months
    for (let i = 0; i <= 6; i++) {
        let month = nowMonth + i;
        let year = nowYear;
        while (month > 12) {
            month -= 12;
            year += 1;
        }
        const label = i === 0 ? '(Current)' : i === 1 ? '(Next)' : '';
        const selected = i === 0 ? 'selected' : '';
        options.push(`<option value="${year}-${month}" ${selected}>${months[month - 1]} ${year} ${label}</option>`);
    }

    document.getElementById('setupMonth').innerHTML = options.join('');
    document.getElementById('setupMonth').addEventListener('change', loadMonthSetup);
}

async function saveMonthSetup() {
    try {
        // Save client inclusions and team assignments
        const clientRows = document.querySelectorAll('[data-client-id]');
        const processedClients = new Set();

        for (const row of clientRows) {
            const clientId = parseInt(row.dataset.clientId);
            if (processedClients.has(clientId)) continue;
            processedClients.add(clientId);

            const checkbox = row.querySelector('.setup-client-checkbox');
            const teamSelect = row.querySelector('.setup-team-select');
            if (!checkbox || !teamSelect) continue;

            await apiCall('/api/status/monthly-clients', {
                method: 'POST',
                body: JSON.stringify({
                    client_id: clientId,
                    is_included: checkbox.checked,
                    team_id: teamSelect.value ? parseInt(teamSelect.value) : null,
                    year: setupYear,
                    month: setupMonth
                })
            });
        }

        // Save deadline overrides
        const deadlineInputs = document.querySelectorAll('.setup-deadline-input');
        for (const input of deadlineInputs) {
            const complianceId = parseInt(input.dataset.complianceId);
            const value = input.value.trim();

            await apiCall('/api/status/monthly-deadlines', {
                method: 'POST',
                body: JSON.stringify({
                    compliance_id: complianceId,
                    year: setupYear,
                    month: setupMonth,
                    custom_deadline_day: value ? parseInt(value) : null
                })
            });
        }

        showToast(`Settings saved for ${getMonthName(setupMonth)} ${setupYear}!`, 'success');
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

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}
