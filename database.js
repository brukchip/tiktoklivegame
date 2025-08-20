const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'tiktok_sessions.db'));
        this.init();
    }

    init() {
        // Create tables if they don't exist
        this.db.serialize(() => {
            // Sessions table
            this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                streamer_username TEXT NOT NULL,
                room_id TEXT,
                session_start DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_end DATETIME,
                status TEXT DEFAULT 'active',
                streamer_info TEXT,
                connection_details TEXT,
                total_events INTEGER DEFAULT 0,
                total_messages INTEGER DEFAULT 0,
                total_gifts INTEGER DEFAULT 0,
                total_likes INTEGER DEFAULT 0,
                total_members INTEGER DEFAULT 0,
                total_social INTEGER DEFAULT 0,
                total_emotes INTEGER DEFAULT 0,
                total_envelopes INTEGER DEFAULT 0,
                total_questions INTEGER DEFAULT 0,
                total_battles INTEGER DEFAULT 0,
                total_room_updates INTEGER DEFAULT 0,
                total_rankings INTEGER DEFAULT 0,
                total_polls INTEGER DEFAULT 0,
                total_shopping INTEGER DEFAULT 0,
                total_moderation INTEGER DEFAULT 0,
                total_captions INTEGER DEFAULT 0,
                total_goals INTEGER DEFAULT 0,
                total_banners INTEGER DEFAULT 0,
                total_links INTEGER DEFAULT 0,
                total_intros INTEGER DEFAULT 0,
                total_other INTEGER DEFAULT 0
            )`);

            // Events table
            this.db.run(`CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_subtype TEXT,
                user_id TEXT,
                username TEXT,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                raw_data TEXT,
                processed_data TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions (id)
            )`);

            // Streamers table (for historical data)
            this.db.run(`CREATE TABLE IF NOT EXISTS streamers (
                username TEXT PRIMARY KEY,
                display_name TEXT,
                follower_count INTEGER,
                bio TEXT,
                profile_image TEXT,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_sessions INTEGER DEFAULT 0,
                total_events_captured INTEGER DEFAULT 0
            )`);

            // Add new columns to existing sessions table (for backward compatibility)
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_emotes INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_envelopes INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_questions INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_battles INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_room_updates INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_rankings INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_polls INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_shopping INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_moderation INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_captions INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_goals INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_banners INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_links INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_intros INTEGER DEFAULT 0`, () => {});
            this.db.run(`ALTER TABLE sessions ADD COLUMN total_other INTEGER DEFAULT 0`, () => {});

            // Create indexes for better performance
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
            this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(streamer_username)`);
        });

        console.log('📊 Database initialized successfully');
    }

    // Session Management
    createSession(sessionId, streamerUsername, roomId, streamerInfo) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO sessions (id, streamer_username, room_id, streamer_info)
                VALUES (?, ?, ?, ?)
            `);
            
            stmt.run([sessionId, streamerUsername, roomId, JSON.stringify(streamerInfo)], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`📝 Created session ${sessionId} for @${streamerUsername}`);
                    resolve(sessionId);
                }
            });
            stmt.finalize();
        });
    }

    endSession(sessionId) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                UPDATE sessions 
                SET session_end = CURRENT_TIMESTAMP, status = 'ended'
                WHERE id = ?
            `);
            
            stmt.run([sessionId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`🔚 Ended session ${sessionId}`);
                    resolve(this.changes);
                }
            });
            stmt.finalize();
        });
    }

    // Event Storage
    addEvent(sessionId, eventType, eventData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT INTO events (session_id, event_type, event_subtype, user_id, username, message, raw_data, processed_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            const processedData = {
                timestamp: new Date().toISOString(),
                eventType,
                ...eventData
            };
            
            stmt.run([
                sessionId,
                eventType,
                eventData.subtype || null,
                eventData.userId || null,
                eventData.username || null,
                eventData.message || null,
                JSON.stringify(eventData.raw || {}),
                JSON.stringify(processedData)
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
            stmt.finalize();
        });
    }

    // Update session counters
    updateSessionCounters(sessionId, eventType) {
        return new Promise((resolve, reject) => {
            let column = 'total_events';
            
            switch (eventType) {
                case 'chat':
                    column = 'total_messages';
                    break;
                case 'gift':
                    column = 'total_gifts';
                    break;
                case 'like':
                    column = 'total_likes';
                    break;
                case 'member':
                    column = 'total_members';
                    break;
                case 'social':
                    column = 'total_social';
                    break;
                case 'emote':
                    column = 'total_emotes';
                    break;
                case 'envelope':
                    column = 'total_envelopes';
                    break;
                case 'question':
                    column = 'total_questions';
                    break;
                case 'battle':
                    column = 'total_battles';
                    break;
                case 'room_update':
                    column = 'total_room_updates';
                    break;
                case 'ranking':
                    column = 'total_rankings';
                    break;
                case 'poll':
                    column = 'total_polls';
                    break;
                case 'shopping':
                    column = 'total_shopping';
                    break;
                case 'moderation':
                    column = 'total_moderation';
                    break;
                case 'caption':
                    column = 'total_captions';
                    break;
                case 'goal':
                    column = 'total_goals';
                    break;
                case 'banner':
                    column = 'total_banners';
                    break;
                case 'link':
                    column = 'total_links';
                    break;
                case 'intro':
                    column = 'total_intros';
                    break;
                case 'other':
                    column = 'total_other';
                    break;
            }
            
            const stmt = this.db.prepare(`
                UPDATE sessions 
                SET total_events = total_events + 1, ${column} = ${column} + 1
                WHERE id = ?
            `);
            
            stmt.run([sessionId], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
            stmt.finalize();
        });
    }

    // Data Retrieval
    getSession(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT * FROM sessions WHERE id = ?
            `, [sessionId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row && row.streamer_info) {
                        row.streamer_info = JSON.parse(row.streamer_info);
                    }
                    resolve(row);
                }
            });
        });
    }

    getSessionEvents(sessionId, eventType = null, limit = 100) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT * FROM events 
                WHERE session_id = ?
            `;
            const params = [sessionId];
            
            if (eventType) {
                query += ` AND event_type = ?`;
                params.push(eventType);
            }
            
            query += ` ORDER BY timestamp DESC LIMIT ?`;
            params.push(limit);
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Parse JSON data
                    const events = rows.map(row => ({
                        ...row,
                        raw_data: row.raw_data ? JSON.parse(row.raw_data) : {},
                        processed_data: row.processed_data ? JSON.parse(row.processed_data) : {}
                    }));
                    resolve(events);
                }
            });
        });
    }

    getAllSessions(limit = 50) {
        return new Promise((resolve, reject) => {
            this.db.all(`
                SELECT 
                    id,
                    streamer_username,
                    room_id,
                    session_start,
                    session_end,
                    status,
                    total_events,
                    total_messages,
                    total_gifts,
                    total_likes,
                    total_members,
                    total_social,
                    total_emotes,
                    total_envelopes,
                    total_questions,
                    total_battles,
                    total_room_updates,
                    total_rankings,
                    total_polls,
                    total_shopping,
                    total_moderation,
                    total_captions,
                    total_goals,
                    total_banners,
                    total_links,
                    total_intros,
                    total_other
                FROM sessions 
                ORDER BY session_start DESC 
                LIMIT ?
            `, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Streamer Management
    upsertStreamer(username, streamerData) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO streamers 
                (username, display_name, follower_count, bio, profile_image, total_sessions, total_events_captured)
                VALUES (?, ?, ?, ?, ?, 
                    COALESCE((SELECT total_sessions FROM streamers WHERE username = ?), 0) + 1,
                    COALESCE((SELECT total_events_captured FROM streamers WHERE username = ?), 0)
                )
            `);
            
            stmt.run([
                username,
                streamerData.displayName || username,
                streamerData.followerCount || 0,
                streamerData.bio || '',
                streamerData.profileImage || '',
                username,
                username
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
            stmt.finalize();
        });
    }

    // Analytics
    getSessionStats(sessionId) {
        return new Promise((resolve, reject) => {
            this.db.get(`
                SELECT 
                    s.*,
                    COUNT(e.id) as actual_event_count,
                    MIN(e.timestamp) as first_event,
                    MAX(e.timestamp) as last_event,
                    COUNT(DISTINCT e.username) as unique_users
                FROM sessions s
                LEFT JOIN events e ON s.id = e.session_id
                WHERE s.id = ?
                GROUP BY s.id
            `, [sessionId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (row && row.streamer_info) {
                        row.streamer_info = JSON.parse(row.streamer_info);
                    }
                    resolve(row);
                }
            });
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = Database;
