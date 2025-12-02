// Spotify Integration for DJ Game
const SpotifyWebApi = require('spotify-web-api-node');
const fetch = require('node-fetch');

class SpotifyIntegration {
    constructor() {
        this.spotifyApi = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: 'http://localhost:3001/callback' // Will be updated dynamically
        });
        
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpirationTime = null;
    }

    // Get current ngrok URL dynamically
    async getCurrentNgrokUrl() {
        try {
            const response = await fetch('http://localhost:4040/api/tunnels');
            const data = await response.json();
            
            if (data.tunnels && data.tunnels.length > 0) {
                const httpsUrl = data.tunnels.find(t => t.proto === 'https')?.public_url;
                return httpsUrl || data.tunnels[0].public_url;
            }
            
            return null;
        } catch (error) {
            console.log('No ngrok tunnel found, using localhost');
            return null;
        }
    }

    // Update redirect URI dynamically
    async updateRedirectUri() {
        const ngrokUrl = await this.getCurrentNgrokUrl();
        const redirectUri = ngrokUrl ? 
            `${ngrokUrl}/callback` : 
            (process.env.SPOTIFY_LOCAL_REDIRECT_URI || 'http://localhost:3001/callback');
        
        this.spotifyApi.setRedirectURI(redirectUri);
        return redirectUri;
    }

    // Set tokens (call this after OAuth flow)
    setTokens(accessToken, refreshToken, expiresIn) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.tokenExpirationTime = Date.now() + (expiresIn * 1000);
        
        this.spotifyApi.setAccessToken(accessToken);
        this.spotifyApi.setRefreshToken(refreshToken);
    }

    // Check if token is expired and refresh if needed
    async ensureValidToken() {
        if (!this.accessToken) {
            throw new Error('No access token available. Please authenticate first.');
        }

        if (Date.now() >= this.tokenExpirationTime) {
            try {
                const data = await this.spotifyApi.refreshAccessToken();
                this.accessToken = data.body.access_token;
                this.tokenExpirationTime = Date.now() + (data.body.expires_in * 1000);
                this.spotifyApi.setAccessToken(this.accessToken);
                console.log('🎵 Spotify token refreshed');
            } catch (error) {
                console.error('Error refreshing Spotify token:', error);
                throw error;
            }
        }
    }

    // Search for a song
    async searchSong(query) {
        try {
            await this.ensureValidToken();
            
            const result = await this.spotifyApi.searchTracks(query, { limit: 5 });
            
            if (result.body.tracks.items.length === 0) {
                return null;
            }

            const track = result.body.tracks.items[0];
            return {
                id: track.id,
                name: track.name,
                artist: track.artists.map(a => a.name).join(', '),
                album: track.album.name,
                duration: track.duration_ms,
                uri: track.uri,
                previewUrl: track.preview_url,
                externalUrl: track.external_urls.spotify
            };
        } catch (error) {
            console.error('Error searching for song:', error);
            return null;
        }
    }

    // Add song to playlist
    async addToPlaylist(playlistId, trackUri) {
        try {
            await this.ensureValidToken();
            
            const result = await this.spotifyApi.addTracksToPlaylist(playlistId, [trackUri]);
            
            return {
                success: true,
                snapshotId: result.body.snapshot_id
            };
        } catch (error) {
            console.error('Error adding song to playlist:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get authentication URL for OAuth flow
    async getAuthUrl() {
        await this.updateRedirectUri();
        
        const scopes = [
            'user-read-private',
            'user-read-email',
            'playlist-modify-public',
            'playlist-modify-private',
            'user-library-read',
            'user-library-modify'
        ];
        
        return this.spotifyApi.createAuthorizeURL(scopes);
    }

    // Handle OAuth callback
    async handleCallback(code) {
        try {
            const data = await this.spotifyApi.authorizationCodeGrant(code);
            
            this.setTokens(
                data.body.access_token,
                data.body.refresh_token,
                data.body.expires_in
            );
            
            return {
                success: true,
                accessToken: data.body.access_token,
                refreshToken: data.body.refresh_token,
                expiresIn: data.body.expires_in
            };
        } catch (error) {
            console.error('Error handling OAuth callback:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Get current user info
    async getCurrentUser() {
        try {
            await this.ensureValidToken();
            
            const result = await this.spotifyApi.getMe();
            
            return {
                id: result.body.id,
                displayName: result.body.display_name,
                email: result.body.email,
                country: result.body.country,
                product: result.body.product,
                uri: result.body.uri,
                externalUrl: result.body.external_urls.spotify
            };
        } catch (error) {
            console.error('Error getting current user:', error);
            return null;
        }
    }
}

module.exports = SpotifyIntegration;
