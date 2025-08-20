const ngrok = require('ngrok');
const axios = require('axios');

class NgrokManager {
    constructor() {
        this.ngrokUrl = null;
        this.isConnected = false;
        this.webhooks = new Map(); // Store external webhook URLs
    }

    // Alternative method to start ngrok via command line
    async startTunnelCommandLine(port = 3001) {
        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);

        try {
            console.log('🔧 Trying alternative ngrok method via command line...');
            
            // Kill any existing ngrok processes
            try {
                await execPromise('pkill -f ngrok');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                // Ignore if no processes to kill
            }

            // Start ngrok in background
            const ngrokProcess = exec(`ngrok http ${port} --log=stdout`);
            
            return new Promise((resolve, reject) => {
                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        ngrokProcess.kill();
                        reject(new Error('Ngrok startup timeout'));
                    }
                }, 30000); // 30 second timeout

                ngrokProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log(`📝 Ngrok: ${output.trim()}`);
                    
                    // Look for the tunnel URL in the output
                    const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.ngrok\.io/);
                    if (urlMatch && !resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        this.ngrokUrl = urlMatch[0];
                        this.isConnected = true;
                        console.log(`✅ Ngrok tunnel active via CLI: ${this.ngrokUrl}`);
                        resolve({
                            success: true,
                            url: this.ngrokUrl,
                            dashboardUrl: this.ngrokUrl,
                            apiUrl: `${this.ngrokUrl}/api`,
                            method: 'command-line'
                        });
                    }
                });

                ngrokProcess.stderr.on('data', (data) => {
                    console.error(`🚨 Ngrok error: ${data.toString().trim()}`);
                });

                ngrokProcess.on('close', (code) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        reject(new Error(`Ngrok process exited with code ${code}`));
                    }
                });
            });
        } catch (error) {
            console.error('❌ Command line ngrok failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Start ngrok tunnel with retry logic
    async startTunnel(port = 3001, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`🚀 Starting ngrok tunnel (attempt ${attempt}/${retries})...`);
                
                // First kill any existing ngrok processes
                await ngrok.kill().catch(() => {});
                
                // Wait a moment before starting
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try different configurations based on attempt
                const configs = [
                    {
                        port: port,
                        region: 'us',
                        onStatusChange: status => console.log(`📡 Ngrok status: ${status}`),
                        onLogEvent: data => {
                            if (data.includes('error') || data.includes('established') || data.includes('started')) {
                                console.log(`📝 Ngrok log: ${data}`);
                            }
                        }
                    },
                    {
                        port: port,
                        region: 'eu',
                        onStatusChange: status => console.log(`📡 Ngrok status: ${status}`),
                        onLogEvent: data => {
                            if (data.includes('error') || data.includes('established') || data.includes('started')) {
                                console.log(`📝 Ngrok log: ${data}`);
                            }
                        }
                    },
                    {
                        port: port,
                        // No region specified - let ngrok choose
                        onStatusChange: status => console.log(`📡 Ngrok status: ${status}`),
                        onLogEvent: data => {
                            if (data.includes('error') || data.includes('established') || data.includes('started')) {
                                console.log(`📝 Ngrok log: ${data}`);
                            }
                        }
                    }
                ];
                
                const config = configs[Math.min(attempt - 1, configs.length - 1)];
                console.log(`🌍 Using region: ${config.region || 'auto'}`);
                
                this.ngrokUrl = await ngrok.connect(config);
                
                this.isConnected = true;
                console.log(`✅ Ngrok tunnel active: ${this.ngrokUrl}`);
                console.log(`🌐 Your TikTok Live Analytics is now accessible worldwide!`);
                console.log(`📊 Dashboard: ${this.ngrokUrl}`);
                console.log(`🔗 API Base: ${this.ngrokUrl}/api`);
                
                return {
                    success: true,
                    url: this.ngrokUrl,
                    dashboardUrl: this.ngrokUrl,
                    apiUrl: `${this.ngrokUrl}/api`
                };
            } catch (error) {
                console.error(`❌ Ngrok attempt ${attempt} failed:`, error.message);
                
                if (attempt === retries) {
                    // Try command line approach as final fallback
                    console.log('🔧 Trying command line ngrok as final fallback...');
                    try {
                        const cliResult = await this.startTunnelCommandLine(port);
                        if (cliResult.success) {
                            return cliResult;
                        }
                    } catch (cliError) {
                        console.error('❌ Command line ngrok also failed:', cliError.message);
                    }
                    
                    this.isConnected = false;
                    return {
                        success: false,
                        error: `Failed after ${retries} attempts: ${error.message}. Try: 1) Check internet connection, 2) Run 'ngrok authtoken YOUR_TOKEN', 3) Try manual: 'ngrok http 3001'`
                    };
                }
                
                // Wait before retrying
                console.log(`⏳ Waiting 5 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    // Stop ngrok tunnel
    async stopTunnel() {
        try {
            if (this.isConnected) {
                console.log('🛑 Stopping ngrok tunnel...');
                await ngrok.disconnect();
                await ngrok.kill();
                this.ngrokUrl = null;
                this.isConnected = false;
                console.log('✅ Ngrok tunnel stopped');
            }
            return { success: true };
        } catch (error) {
            console.error('❌ Failed to stop ngrok tunnel:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get current tunnel status
    getStatus() {
        return {
            isConnected: this.isConnected,
            url: this.ngrokUrl,
            webhooks: Array.from(this.webhooks.entries()).map(([id, webhook]) => ({
                id,
                ...webhook
            }))
        };
    }

    // Add external webhook
    addWebhook(id, url, events = ['all'], headers = {}) {
        this.webhooks.set(id, {
            url,
            events,
            headers,
            active: true,
            created: new Date().toISOString(),
            lastSent: null,
            totalSent: 0,
            errors: 0
        });
        console.log(`📡 Added webhook: ${id} -> ${url}`);
        return { success: true, id };
    }

    // Remove webhook
    removeWebhook(id) {
        const removed = this.webhooks.delete(id);
        if (removed) {
            console.log(`🗑️ Removed webhook: ${id}`);
        }
        return { success: removed };
    }

    // Send data to external webhooks
    async sendToWebhooks(eventType, data) {
        const results = [];
        
        for (const [id, webhook] of this.webhooks.entries()) {
            if (!webhook.active) continue;
            
            // Check if webhook is interested in this event type
            if (!webhook.events.includes('all') && !webhook.events.includes(eventType)) {
                continue;
            }

            try {
                const payload = {
                    timestamp: new Date().toISOString(),
                    source: 'tiktok-live-connector',
                    ngrokUrl: this.ngrokUrl,
                    eventType,
                    data
                };

                const response = await axios.post(webhook.url, payload, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'TikTok-Live-Connector/1.0',
                        ...webhook.headers
                    },
                    timeout: 10000 // 10 second timeout
                });

                // Update webhook stats
                webhook.lastSent = new Date().toISOString();
                webhook.totalSent++;

                results.push({
                    id,
                    success: true,
                    status: response.status,
                    response: response.data
                });

                console.log(`📤 Sent ${eventType} to webhook ${id}: ${response.status}`);

            } catch (error) {
                webhook.errors++;
                results.push({
                    id,
                    success: false,
                    error: error.message,
                    status: error.response?.status
                });

                console.error(`❌ Failed to send to webhook ${id}:`, error.message);
            }
        }

        return results;
    }

    // Send live session data to external API
    async sendSessionData(sessionData, externalApiUrl, apiKey = null) {
        try {
            const payload = {
                timestamp: new Date().toISOString(),
                source: 'tiktok-live-connector',
                ngrokUrl: this.ngrokUrl,
                sessionData: {
                    id: sessionData.id,
                    streamer: sessionData.streamer_username,
                    roomId: sessionData.room_id,
                    status: sessionData.status,
                    stats: sessionData.stats,
                    events: sessionData.events?.slice(-100) || [] // Send last 100 events
                }
            };

            const headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'TikTok-Live-Connector/1.0'
            };

            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
                headers['X-API-Key'] = apiKey;
            }

            const response = await axios.post(externalApiUrl, payload, {
                headers,
                timeout: 15000 // 15 second timeout
            });

            console.log(`📤 Successfully sent session data to external API: ${response.status}`);
            return {
                success: true,
                status: response.status,
                response: response.data
            };

        } catch (error) {
            console.error('❌ Failed to send session data to external API:', error.message);
            return {
                success: false,
                error: error.message,
                status: error.response?.status
            };
        }
    }

    // Export session data in various formats
    exportSessionData(sessionData, format = 'json') {
        const exportData = {
            timestamp: new Date().toISOString(),
            source: 'tiktok-live-connector',
            ngrokUrl: this.ngrokUrl,
            session: sessionData
        };

        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(exportData, null, 2);
            
            case 'csv':
                // Convert events to CSV
                if (sessionData.events && sessionData.events.length > 0) {
                    const headers = Object.keys(sessionData.events[0]).join(',');
                    const rows = sessionData.events.map(event => 
                        Object.values(event).map(value => 
                            typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value
                        ).join(',')
                    );
                    return [headers, ...rows].join('\n');
                }
                return 'No events to export';
            
            case 'summary':
                return JSON.stringify({
                    timestamp: exportData.timestamp,
                    source: exportData.source,
                    ngrokUrl: exportData.ngrokUrl,
                    sessionSummary: {
                        id: sessionData.id,
                        streamer: sessionData.streamer_username,
                        duration: sessionData.session_end ? 
                            new Date(sessionData.session_end) - new Date(sessionData.session_start) : 
                            Date.now() - new Date(sessionData.session_start),
                        totalEvents: sessionData.total_events || 0,
                        eventBreakdown: {
                            messages: sessionData.total_messages || 0,
                            gifts: sessionData.total_gifts || 0,
                            likes: sessionData.total_likes || 0,
                            members: sessionData.total_members || 0,
                            social: sessionData.total_social || 0,
                            shares: sessionData.events?.filter(e => e.event_subtype === 'share').length || 0
                        }
                    }
                }, null, 2);
            
            default:
                return JSON.stringify(exportData, null, 2);
        }
    }

    // Generate public dashboard URL
    getPublicDashboardUrl() {
        return this.ngrokUrl ? `${this.ngrokUrl}` : null;
    }

    // Generate API documentation URL
    getApiDocsUrl() {
        return this.ngrokUrl ? `${this.ngrokUrl}/api-docs` : null;
    }

    // Health check for ngrok connection
    async healthCheck() {
        if (!this.isConnected || !this.ngrokUrl) {
            return { healthy: false, error: 'Not connected' };
        }

        try {
            const response = await axios.get(`${this.ngrokUrl}/api/health`, {
                timeout: 5000
            });
            return { 
                healthy: true, 
                status: response.status,
                ngrokUrl: this.ngrokUrl
            };
        } catch (error) {
            return { 
                healthy: false, 
                error: error.message,
                ngrokUrl: this.ngrokUrl
            };
        }
    }
}

module.exports = NgrokManager;
