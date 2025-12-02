// TikTok Live DJ Game System
class DJGameSystem {
    constructor(database = null) {
        this.activeGames = new Map(); // sessionId -> gameData
        this.gameHistory = [];
        this.db = database;
        this.settings = null;
        
        // Load settings on startup
        this.loadSettings();
    }

    async loadSettings() {
        if (!this.db) {
            console.log('🎵 DJ Game: No database provided, using default settings');
            return;
        }

        try {
            this.settings = await this.db.getGameSettings();
            if (this.settings?.djGame) {
                console.log('🎵 DJ Game: Settings loaded successfully');
                console.log(`   Request Phase: ${this.settings.djGame.requestDuration || 30}s`);
                console.log(`   Voting Phase: ${this.settings.djGame.votingDuration || 30}s`);
            } else {
                console.log('🎵 DJ Game: No settings found, using defaults');
            }
        } catch (error) {
            console.error('🎵 DJ Game: Error loading settings:', error);
        }
    }

    // Get setting value with fallback to default
    getSetting(key, defaultValue) {
        if (!this.settings?.djGame) {
            return defaultValue;
        }
        return this.settings.djGame[key] || defaultValue;
    }

    // Start new DJ Game session
    startDJGame(sessionId) {
        const requestDuration = this.getSetting('requestDuration', 30) * 1000;
        
        const gameData = {
            type: 'djgame',
            sessionId,
            status: 'requesting', // 'requesting' -> 'voting' -> 'playing' -> 'ended'
            phase: 'song-request',
            startTime: new Date(),
            duration: requestDuration,
            endTime: new Date(Date.now() + requestDuration),
            songRequests: new Map(), // songName -> { count: number, users: Set }
            topSongs: [], // Top 4 songs with letters A, B, C, D
            votes: new Map(), // A, B, C, D -> { count: number, users: Set }
            currentRound: 1,
            winner: null,
            playlist: [],
            autoLoop: true,
            // Enhanced tracking for interactivity
            participants: new Set(),
            totalRequests: 0,
            uniqueUsers: 0,
            phaseStartTime: new Date(),
            timeRemaining: requestDuration,
            liveStats: {
                requestsPerSecond: 0,
                topRequesters: [],
                popularSongs: []
            }
        };

        this.activeGames.set(sessionId, gameData);
        console.log(`🎵 DJ Game started for session ${sessionId} - Phase 1: Song Request (${requestDuration/1000}s)`);

        // Auto-advance to voting phase
        setTimeout(() => {
            this.advanceToVotingPhase(sessionId);
        }, requestDuration);

        return gameData;
    }

    // Add song request from chat
    addSongRequest(sessionId, username, message) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame' || game.phase !== 'song-request') {
            return false;
        }

        // Extract song name from message (remove common prefixes)
        let songName = message.trim();
        const prefixes = ['PLAY:', 'SONG:', 'REQUEST:', 'MUSIC:'];
        
        for (const prefix of prefixes) {
            if (songName.toUpperCase().startsWith(prefix)) {
                songName = songName.substring(prefix.length).trim();
                break;
            }
        }

        if (songName.length < 2) return false; // Too short

        // Normalize song name (capitalize first letter of each word)
        songName = songName.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

        // Add or update song request
        if (!game.songRequests.has(songName)) {
            game.songRequests.set(songName, { count: 0, users: new Set() });
        }

        const songData = game.songRequests.get(songName);
        if (!songData.users.has(username)) {
            songData.count++;
            songData.users.add(username);
            
            // Enhanced tracking for interactivity
            game.participants.add(username);
            game.totalRequests++;
            game.uniqueUsers = game.participants.size;
            
            // Update live stats
            this.updateLiveStats(game);
            
            console.log(`🎵 Song request: "${songName}" by @${username} (Total: ${songData.count}, Participants: ${game.uniqueUsers})`);
        }

        return true;
    }

    // Advance to voting phase
    advanceToVotingPhase(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return false;
        }

        // Get top 4 most requested songs
        const sortedSongs = Array.from(game.songRequests.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 4);

        if (sortedSongs.length === 0) {
            console.log(`🎵 DJ Game: No song requests received, ending game`);
            this.endDJGame(sessionId);
            return false;
        }

        // Assign letters to songs
        game.topSongs = sortedSongs.map((song, index) => ({
            letter: String.fromCharCode(65 + index), // A, B, C, D
            name: song[0],
            requestCount: song[1].count,
            voters: song[1].users
        }));

        // Initialize voting phase
        game.phase = 'voting';
        game.status = 'voting';
        game.duration = this.getSetting('votingDuration', 30) * 1000;
        game.endTime = new Date(Date.now() + game.duration);

        console.log(`🎵 DJ Game Phase 2: Voting started!`);
        game.topSongs.forEach(song => {
            console.log(`   ${song.letter}: ${song.name} (${song.requestCount} requests)`);
        });

        // Auto-end voting phase
        setTimeout(() => {
            this.endVotingPhase(sessionId);
        }, game.duration);

        return true;
    }

    // Add vote from chat
    addVote(sessionId, username, message) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame' || game.phase !== 'voting') {
            return false;
        }

        const vote = message.trim().toUpperCase();
        if (!['A', 'B', 'C', 'D'].includes(vote)) {
            return false;
        }

        // Find the song for this vote
        const songIndex = vote.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
        const song = game.topSongs[songIndex];
        
        if (!song) return false;

        // Initialize votes map if needed
        if (!game.votes.has(vote)) {
            game.votes.set(vote, { count: 0, users: new Set() });
        }

        const voteData = game.votes.get(vote);
        
        // Check if user already voted
        if (voteData.users.has(username)) {
            return false; // Already voted
        }

        // Add vote
        voteData.count++;
        voteData.users.add(username);
        
        console.log(`🗳️ Vote ${vote} for "${song.name}" by @${username} (Total votes: ${voteData.count})`);

        return true;
    }

    // End voting phase and determine winner
    endVotingPhase(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return false;
        }

        // Find song with most votes
        let winner = null;
        let maxVotes = 0;

        for (const [letter, voteData] of game.votes.entries()) {
            if (voteData.count > maxVotes) {
                maxVotes = voteData.count;
                winner = letter;
            }
        }

        if (!winner) {
            console.log(`🎵 DJ Game: No votes received, ending game`);
            this.endDJGame(sessionId);
            return false;
        }

        // Get winning song details
        const songIndex = winner.charCodeAt(0) - 65;
        const winningSong = game.topSongs[songIndex];

        game.winner = {
            letter: winner,
            song: winningSong.name,
            votes: maxVotes,
            requestCount: winningSong.requestCount
        };

        // Add to playlist
        game.playlist.push({
            song: winningSong.name,
            winner: game.winner,
            round: game.currentRound,
            timestamp: new Date()
        });

        console.log(`🏆 DJ Game Winner: "${winningSong.name}" (${winner}) with ${maxVotes} votes!`);
        console.log(`   Added to playlist. Round ${game.currentRound} complete.`);

        // Auto-start next round if enabled
        if (game.autoLoop) {
            setTimeout(() => {
                this.startNextRound(sessionId);
            }, 5000); // 5 second break between rounds
        } else {
            this.endDJGame(sessionId);
        }

        return game.winner;
    }

    // Start next round
    startNextRound(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return false;
        }

        // Reset for new round
        game.currentRound++;
        game.phase = 'song-request';
        game.status = 'requesting';
        game.songRequests.clear();
        game.topSongs = [];
        game.votes.clear();
        game.winner = null;
        game.duration = this.getSetting('requestDuration', 30) * 1000;
        game.endTime = new Date(Date.now() + game.duration);

        console.log(`🎵 DJ Game Round ${game.currentRound}: Song Request phase started (${game.duration/1000}s)`);

        // Auto-advance to voting phase
        setTimeout(() => {
            this.advanceToVotingPhase(sessionId);
        }, game.duration);

        return true;
    }

    // End DJ Game
    endDJGame(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return false;
        }

        game.status = 'ended';
        game.phase = 'ended';
        game.actualEndTime = new Date();

        // Add to history
        this.gameHistory.push({
            ...game,
            totalRounds: game.currentRound,
            totalSongs: game.playlist.length,
            finalPlaylist: game.playlist
        });

        console.log(`🎵 DJ Game ended after ${game.currentRound} rounds with ${game.playlist.length} songs`);

        return {
            totalRounds: game.currentRound,
            playlist: game.playlist,
            gameData: game
        };
    }

    // Get game status
    getDJGameStatus(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return null;
        }

        return {
            status: game.status,
            phase: game.phase,
            currentRound: game.currentRound,
            timeRemaining: Math.max(0, game.endTime.getTime() - Date.now()),
            songRequests: Array.from(game.songRequests.entries()).map(([song, data]) => ({
                song,
                count: data.count,
                users: Array.from(data.users)
            })),
            topSongs: game.topSongs,
            votes: Array.from(game.votes.entries()).map(([letter, data]) => ({
                letter,
                count: data.count,
                users: Array.from(data.users)
            })),
            winner: game.winner,
            playlist: game.playlist,
            // Enhanced interactive data
            participants: Array.from(game.participants),
            totalRequests: game.totalRequests,
            uniqueUsers: game.uniqueUsers,
            phaseStartTime: game.phaseStartTime,
            liveStats: game.liveStats,
            // Real-time counters
            requestsPerSecond: this.calculateRequestsPerSecond(game),
            topRequesters: this.getTopRequesters(game),
            popularSongs: this.getPopularSongs(game)
        };
    }

    // Get game history
    getDJGameHistory(sessionId = null, limit = 10) {
        let history = this.gameHistory.filter(game => game.type === 'djgame');
        
        if (sessionId) {
            history = history.filter(game => game.sessionId === sessionId);
        }
        
        return history
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .slice(0, limit);
    }

    getDJGamePlaylist(sessionId) {
        const game = this.activeGames.get(sessionId);
        if (!game || game.type !== 'djgame') {
            return [];
        }
        
        return game.playlist || [];
    }

    // Helper methods for live stats
    updateLiveStats(game) {
        const now = Date.now();
        const phaseDuration = (now - game.phaseStartTime.getTime()) / 1000;
        
        if (phaseDuration > 0) {
            game.liveStats.requestsPerSecond = (game.totalRequests / phaseDuration).toFixed(2);
        }
        
        // Update top requesters
        const userRequestCounts = new Map();
        for (const [songName, songData] of game.songRequests.entries()) {
            for (const username of songData.users) {
                userRequestCounts.set(username, (userRequestCounts.get(username) || 0) + 1);
            }
        }
        
        game.liveStats.topRequesters = Array.from(userRequestCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([username, count]) => ({ username, count }));
        
        // Update popular songs
        game.liveStats.popularSongs = Array.from(game.songRequests.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([songName, data]) => ({ songName, count: data.count }));
    }

    calculateRequestsPerSecond(game) {
        const now = Date.now();
        const phaseDuration = (now - game.phaseStartTime.getTime()) / 1000;
        return phaseDuration > 0 ? (game.totalRequests / phaseDuration).toFixed(2) : '0.00';
    }

    getTopRequesters(game) {
        const userRequestCounts = new Map();
        for (const [songName, songData] of game.songRequests.entries()) {
            for (const username of songData.users) {
                userRequestCounts.set(username, (userRequestCounts.get(username) || 0) + 1);
            }
        }
        
        return Array.from(userRequestCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([username, count]) => ({ username, count }));
    }

    getPopularSongs(game) {
        return Array.from(game.songRequests.entries())
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5)
            .map(([songName, data]) => ({ songName, count: data.count }));
    }

    // Clean up ended games
    cleanup() {
        const now = Date.now();
        for (const [sessionId, game] of this.activeGames.entries()) {
            if (game.type === 'djgame' && (game.status === 'ended' || now > game.endTime.getTime() + 60000)) {
                this.activeGames.delete(sessionId);
                console.log(`🧹 Cleaned up ended DJ Game for session ${sessionId}`);
            }
        }
    }
}

module.exports = DJGameSystem;
