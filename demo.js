#!/usr/bin/env node

const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('./dist/index');

// Username of someone who might be live - you can change this
const tiktokUsername = process.argv[2] || 'officialgeilegisela';

console.log(`🚀 TikTok Live Connector Demo`);
console.log(`===============================`);
console.log(`Target user: @${tiktokUsername}`);
console.log(`Usage: node demo.js [username]`);
console.log(`===============================\n`);

// Create a new connection
const connection = new TikTokLiveConnection(tiktokUsername, {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    fetchRoomInfoOnConnect: true
});

// Connection Events
connection.on(ControlEvent.CONNECTED, (state) => {
    console.log(`✅ Connected to room ${state.roomId}`);
    console.log(`👤 Host: ${state.roomInfo?.owner?.uniqueId || 'Unknown'}`);
    console.log(`👥 Viewer Count: ${state.roomInfo?.user_count || 'Unknown'}`);
    console.log(`🔴 Live Status: ${state.roomInfo?.status || 'Unknown'}`);
    console.log(`---`);
});

connection.on(ControlEvent.DISCONNECTED, () => {
    console.log('❌ Disconnected from TikTok LIVE');
});

connection.on(ControlEvent.STREAM_END, () => {
    console.log('🛑 Stream has ended');
});

connection.on(ControlEvent.ERROR, (err) => {
    console.error('❌ Error:', err.message);
});

// Message Events
connection.on(WebcastEvent.CHAT, (data) => {
    console.log(`💬 ${data.user.uniqueId}: ${data.comment}`);
});

connection.on(WebcastEvent.GIFT, (data) => {
    if (data.giftType === 1 && !data.repeatEnd) {
        // Streak in progress
        console.log(`🎁 ${data.user.uniqueId} is sending ${data.giftName} x${data.repeatCount} (streak in progress)`);
    } else {
        // Final gift or non-streakable gift
        console.log(`🎁 ${data.user.uniqueId} sent ${data.giftName} x${data.repeatCount}`);
    }
});

connection.on(WebcastEvent.MEMBER, (data) => {
    console.log(`👋 ${data.user.uniqueId} joined the stream`);
});

connection.on(WebcastEvent.LIKE, (data) => {
    console.log(`❤️ ${data.user.uniqueId} sent ${data.likeCount} likes (total: ${data.totalLikeCount})`);
});

connection.on(WebcastEvent.SOCIAL, (data) => {
    console.log(`📱 Social event:`, data);
});

connection.on(WebcastEvent.FOLLOW, (data) => {
    console.log(`➕ ${data.user.uniqueId} followed the streamer!`);
});

connection.on(WebcastEvent.SHARE, (data) => {
    console.log(`📤 ${data.user.uniqueId} shared the stream!`);
});

connection.on(WebcastEvent.ROOM_USER, (data) => {
    console.log(`👥 Current viewers: ${data.viewerCount}`);
});

connection.on(WebcastEvent.SUBSCRIBE, (data) => {
    console.log(`⭐ ${data.user.uniqueId} subscribed!`);
});

connection.on(WebcastEvent.EMOTE, (data) => {
    console.log(`😄 ${data.user.uniqueId} sent an emote: ${data.emote?.image?.url_list?.[0] || 'Unknown emote'}`);
});

// First, check if user is live
async function checkAndConnect() {
    try {
        console.log(`🔍 Checking if @${tiktokUsername} is live...`);
        
        // Check if the user is currently live
        const isLive = await connection.fetchIsLive();
        
        if (!isLive) {
            console.log(`❌ @${tiktokUsername} is not currently live.`);
            console.log(`💡 Try with a different username or wait for them to go live.`);
            console.log(`💡 You can also try: node demo.js username_of_live_user`);
            return;
        }
        
        console.log(`✅ @${tiktokUsername} is live! Connecting...`);
        
        // Connect to the live stream
        await connection.connect();
        
    } catch (error) {
        console.error(`❌ Failed to connect: ${error.message}`);
        console.log(`💡 Make sure the username is correct and the user is currently live.`);
        console.log(`💡 Try with a different username: node demo.js username_of_live_user`);
    }
}

// Handle process exit
process.on('SIGINT', () => {
    console.log('\n🛑 Disconnecting...');
    connection.disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Disconnecting...');
    connection.disconnect();
    process.exit(0);
});

// Start the demo
checkAndConnect();
