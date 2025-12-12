// TikTok Live Connector Data Viewer
class DataViewer {
    constructor() {
        // Automatically detect API base URL - works both locally and on deployed server
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        this.API_BASE = isLocalhost
            ? 'http://localhost:3001/api'
            : `${window.location.protocol}//${window.location.host}/api`;

        console.log('🌐 Data Viewer API Base URL:', this.API_BASE);

        this.currentEventFilter = 'all';
        this.cachedData = {
            sessions: [],
            events: [],
            health: null
        };

        this.init();
    }

    init() {
        console.log('📊 Data Viewer initialized');
        this.loadAllData();

        // Auto-refresh every 30 seconds
        setInterval(() => {
            this.loadSystemData();
            this.loadApiStatus();
        }, 30000);
    }

    async loadAllData() {
        await Promise.all([
            this.loadSystemData(),
            this.loadSessionsData(),
            this.loadEventsData(),
            this.loadApiStatus(),
            this.loadDatabaseStats(),
            this.loadRawData()
        ]);
    }

    async loadSystemData() {
        try {
            // Load health data
            const healthResponse = await fetch(`${this.API_BASE}/health`);
            const healthData = await healthResponse.json();
            this.cachedData.health = healthData;

            // Load sessions data
            const sessionsResponse = await fetch(`${this.API_BASE}/sessions`);
            const sessionsData = await sessionsResponse.json();
            this.cachedData.sessions = sessionsData.sessions || [];

            // Calculate stats
            const totalSessions = this.cachedData.sessions.length;
            const activeSessions = healthData.activeSessions || 0;
            const totalEvents = this.cachedData.sessions.reduce((sum, session) => sum + (session.total_events || 0), 0);
            const uniqueStreamers = [...new Set(this.cachedData.sessions.map(s => s.streamer_username))].length;

            // Update UI
            document.getElementById('totalSessions').textContent = totalSessions;
            document.getElementById('activeSessions').textContent = activeSessions;
            document.getElementById('totalEvents').textContent = totalEvents.toLocaleString();
            document.getElementById('totalStreamers').textContent = uniqueStreamers;

        } catch (error) {
            console.error('Error loading system data:', error);
            this.showError('Failed to load system data');
        }
    }

    async loadSessionsData() {
        try {
            const response = await fetch(`${this.API_BASE}/sessions`);
            const data = await response.json();
            this.cachedData.sessions = data.sessions || [];

            const tbody = document.getElementById('sessionsTableBody');

            if (this.cachedData.sessions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; opacity: 0.7;">No sessions found</td></tr>';
                return;
            }

            const rows = this.cachedData.sessions.slice(0, 50).map(session => {
                const startTime = new Date(session.session_start);
                const endTime = session.session_end ? new Date(session.session_end) : new Date();
                const duration = this.formatDuration(endTime - startTime);

                return `
                    <tr onclick="this.showSessionDetails('${session.id}')" style="cursor: pointer;">
                        <td>@${session.streamer_username}</td>
                        <td class="${session.isActive ? 'status-active' : 'status-ended'}">
                            ${session.isActive ? '🟢 LIVE' : '⚫ ENDED'}
                        </td>
                        <td>${(session.total_events || 0).toLocaleString()}</td>
                        <td>${duration}</td>
                    </tr>
                `;
            }).join('');

            tbody.innerHTML = rows;

        } catch (error) {
            console.error('Error loading sessions data:', error);
            document.getElementById('sessionsTableBody').innerHTML =
                '<tr><td colspan="4" style="color: #f44336;">Error loading sessions</td></tr>';
        }
    }

    async loadEventsData() {
        try {
            // Get recent events from the most recent session
            if (this.cachedData.sessions.length === 0) {
                document.getElementById('eventsTableBody').innerHTML =
                    '<tr><td colspan="4" style="text-align: center; opacity: 0.7;">No sessions available</td></tr>';
                return;
            }

            const mostRecentSession = this.cachedData.sessions[0];
            const response = await fetch(`${this.API_BASE}/sessions/${mostRecentSession.id}/events?limit=100`);
            const data = await response.json();
            this.cachedData.events = data.events || [];

            this.updateEventsTable();

        } catch (error) {
            console.error('Error loading events data:', error);
            document.getElementById('eventsTableBody').innerHTML =
                '<tr><td colspan="4" style="color: #f44336;">Error loading events</td></tr>';
        }
    }

    updateEventsTable() {
        const tbody = document.getElementById('eventsTableBody');
        let filteredEvents = this.cachedData.events;

        // Apply filter
        if (this.currentEventFilter !== 'all') {
            filteredEvents = this.cachedData.events.filter(event => event.type === this.currentEventFilter);
        }

        if (filteredEvents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; opacity: 0.7;">No events found</td></tr>';
            return;
        }

        const rows = filteredEvents.slice(0, 50).map(event => {
            const time = new Date(event.timestamp).toLocaleTimeString();
            const typeClass = `event-type-${event.type}`;
            const userData = this.formatEventData(event);

            return `
                <tr>
                    <td>${time}</td>
                    <td class="${typeClass}">${event.type}</td>
                    <td>${event.username || 'System'}</td>
                    <td>${userData}</td>
                </tr>
            `;
        }).join('');

        tbody.innerHTML = rows;
    }

    formatEventData(event) {
        switch (event.type) {
            case 'chat':
                return event.message || '';
            case 'gift':
                return `${event.giftName || 'Gift'} ${event.repeatCount > 1 ? `x${event.repeatCount}` : ''}`;
            case 'like':
                return `${event.likeCount || 1} likes`;
            case 'member':
                return 'Joined stream';
            case 'social':
                return event.subtype || event.action || 'Social action';
            case 'room_update':
                return `${event.viewerCount || 0} viewers`;
            default:
                return event.subtype || '-';
        }
    }

    async loadApiStatus() {
        try {
            const response = await fetch(`${this.API_BASE}/health`);
            const data = await response.json();

            const container = document.getElementById('apiStatusContent');

            container.innerHTML = `
                <div class="stats-overview">
                    <div class="stat-box">
                        <div class="stat-number" style="color: #4CAF50;">✅</div>
                        <div class="stat-label">API Status</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${data.activeSessions}</div>
                        <div class="stat-label">Active Sessions</div>
                    </div>
                </div>
                <div style="margin-top: 15px; font-size: 12px; opacity: 0.8;">
                    Last updated: ${new Date(data.timestamp).toLocaleString()}
                </div>
            `;

        } catch (error) {
            console.error('Error loading API status:', error);
            document.getElementById('apiStatusContent').innerHTML =
                '<div style="color: #f44336;">❌ API Connection Failed</div>';
        }
    }

    async loadDatabaseStats() {
        try {
            const sessionsResponse = await fetch(`${this.API_BASE}/sessions`);
            const sessionsData = await sessionsResponse.json();
            const sessions = sessionsData.sessions || [];

            // Calculate database statistics
            const totalSessions = sessions.length;
            const totalMessages = sessions.reduce((sum, s) => sum + (s.total_messages || 0), 0);
            const totalGifts = sessions.reduce((sum, s) => sum + (s.total_gifts || 0), 0);
            const totalLikes = sessions.reduce((sum, s) => sum + (s.total_likes || 0), 0);

            const avgEventsPerSession = totalSessions > 0 ?
                Math.round(sessions.reduce((sum, s) => sum + (s.total_events || 0), 0) / totalSessions) : 0;

            const container = document.getElementById('databaseStatsContent');

            container.innerHTML = `
                <div class="stats-overview">
                    <div class="stat-box">
                        <div class="stat-number">${totalMessages.toLocaleString()}</div>
                        <div class="stat-label">Total Messages</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${totalGifts.toLocaleString()}</div>
                        <div class="stat-label">Total Gifts</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${totalLikes.toLocaleString()}</div>
                        <div class="stat-label">Total Likes</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number">${avgEventsPerSession}</div>
                        <div class="stat-label">Avg Events/Session</div>
                    </div>
                </div>
            `;

        } catch (error) {
            console.error('Error loading database stats:', error);
            document.getElementById('databaseStatsContent').innerHTML =
                '<div style="color: #f44336;">❌ Database Stats Failed</div>';
        }
    }

    async loadRawData() {
        const select = document.getElementById('dataTypeSelect');
        const viewer = document.getElementById('rawDataViewer');
        const dataType = select.value;

        viewer.innerHTML = '<div class="loading">Loading...</div>';

        try {
            let endpoint;
            switch (dataType) {
                case 'health':
                    endpoint = '/health';
                    break;
                case 'sessions':
                    endpoint = '/sessions';
                    break;
                default:
                    endpoint = '/health';
            }

            const response = await fetch(`${this.API_BASE}${endpoint}`);
            const data = await response.json();

            viewer.innerHTML = JSON.stringify(data, null, 2);

        } catch (error) {
            console.error('Error loading raw data:', error);
            viewer.innerHTML = `Error loading ${dataType} data: ${error.message}`;
        }
    }

    filterEvents(type) {
        this.currentEventFilter = type;

        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // Update table
        this.updateEventsTable();
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async exportSessions(format) {
        try {
            const response = await fetch(`${this.API_BASE}/sessions`);
            const data = await response.json();

            if (format === 'json') {
                this.downloadJSON(data, 'sessions-export.json');
            } else if (format === 'csv') {
                this.downloadCSV(data.sessions, 'sessions-export.csv');
            }

            this.showSuccess(`Sessions exported as ${format.toUpperCase()}`);
        } catch (error) {
            console.error('Export error:', error);
            this.showError('Export failed');
        }
    }

    downloadJSON(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    downloadCSV(sessions, filename) {
        if (!sessions || sessions.length === 0) {
            this.showError('No session data to export');
            return;
        }

        // Create CSV headers
        const headers = [
            'ID', 'Streamer', 'Room ID', 'Start Time', 'End Time', 'Status',
            'Total Events', 'Messages', 'Gifts', 'Likes', 'Members', 'Social'
        ];

        // Create CSV rows
        const rows = sessions.map(session => [
            session.id,
            session.streamer_username,
            session.room_id,
            session.session_start,
            session.session_end || '',
            session.status,
            session.total_events || 0,
            session.total_messages || 0,
            session.total_gifts || 0,
            session.total_likes || 0,
            session.total_members || 0,
            session.total_social || 0
        ]);

        // Combine headers and rows
        const csvContent = [headers, ...rows]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showSessionDetails(sessionId) {
        // Navigate to main dashboard with session selected
        window.location.href = `index.html?session=${sessionId}`;
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        // Create temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            border-radius: 8px;
            color: white;
            font-weight: bold;
            z-index: 10000;
            transition: all 0.3s ease;
            ${type === 'success' ? 'background: #4CAF50;' : 'background: #f44336;'}
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (document.body.contains(notification)) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Global functions for HTML onclick handlers
let dataViewer;

function loadSystemData() {
    dataViewer.loadSystemData();
}

function loadSessionsData() {
    dataViewer.loadSessionsData();
}

function loadEventsData() {
    dataViewer.loadEventsData();
}

function loadApiStatus() {
    dataViewer.loadApiStatus();
}

function loadDatabaseStats() {
    dataViewer.loadDatabaseStats();
}

function loadRawData() {
    dataViewer.loadRawData();
}

function filterEvents(type) {
    dataViewer.filterEvents(type);
}

function exportSessions(format) {
    dataViewer.exportSessions(format);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    dataViewer = new DataViewer();
});
