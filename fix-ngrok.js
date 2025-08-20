#!/usr/bin/env node

console.log('🔧 TikTok Live Connector - Ngrok Troubleshoot & Fix');
console.log('===================================================');

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function fixNgrok() {
    try {
        console.log('\n1️⃣ Checking ngrok installation...');
        const { stdout: version } = await execPromise('ngrok version');
        console.log(`✅ Ngrok installed: ${version.trim()}`);

        console.log('\n2️⃣ Checking ngrok configuration...');
        try {
            await execPromise('ngrok config check');
            console.log('✅ Ngrok configuration is valid');
        } catch (error) {
            console.log('❌ Ngrok configuration issue:', error.message);
            console.log('💡 Fix: Run "ngrok authtoken YOUR_TOKEN" with your ngrok auth token');
            console.log('   Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken');
            return;
        }

        console.log('\n3️⃣ Killing any existing ngrok processes...');
        try {
            await execPromise('pkill -f ngrok');
            console.log('✅ Cleaned up existing ngrok processes');
        } catch (error) {
            console.log('ℹ️ No existing ngrok processes found');
        }

        console.log('\n4️⃣ Testing ngrok connectivity...');
        console.log('⏳ Starting test tunnel (this may take 15-30 seconds)...');
        
        const ngrokProcess = exec('ngrok http 3001 --log=stdout');
        let tunnelUrl = null;
        let connected = false;

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!connected) {
                    ngrokProcess.kill();
                    console.log('❌ Ngrok connection timeout');
                    console.log('\n💡 Manual fix:');
                    console.log('   1. Open Terminal');
                    console.log('   2. Run: ngrok http 3001');
                    console.log('   3. Copy the https://xyz.ngrok.io URL');
                    console.log('   4. Use this URL manually');
                    resolve(false);
                }
            }, 30000);

            ngrokProcess.stdout.on('data', (data) => {
                const output = data.toString();
                
                // Look for the tunnel URL
                const urlMatch = output.match(/url=https:\/\/[a-z0-9-]+\.ngrok[-\w]*\.app/);
                if (urlMatch && !connected) {
                    connected = true;
                    clearTimeout(timeout);
                    tunnelUrl = urlMatch[0].replace('url=', '');
                    console.log(`✅ Ngrok tunnel successful: ${tunnelUrl}`);
                    
                    // Clean up
                    ngrokProcess.kill();
                    
                    console.log('\n🎉 Ngrok is working properly!');
                    console.log('\n📝 What to do next:');
                    console.log('   1. Restart your backend server');
                    console.log('   2. Try the "🚀 Start Public Access" button again');
                    console.log('   3. If it still fails, use manual method below');
                    
                    console.log('\n🔧 Manual Method (if button still fails):');
                    console.log('   1. Open Terminal and run: ngrok http 3001');
                    console.log('   2. Copy the https URL from ngrok output');
                    console.log('   3. Share that URL instead of using the button');
                    
                    resolve(true);
                }
            });

            ngrokProcess.stderr.on('data', (data) => {
                const error = data.toString();
                if (error.includes('ERROR') || error.includes('failed')) {
                    console.error(`❌ Ngrok error: ${error.trim()}`);
                }
            });

            ngrokProcess.on('close', (code) => {
                if (!connected) {
                    clearTimeout(timeout);
                    console.log(`❌ Ngrok process exited with code ${code}`);
                    resolve(false);
                }
            });
        });

    } catch (error) {
        console.error('❌ Error during troubleshooting:', error.message);
        
        console.log('\n🆘 Manual Setup Instructions:');
        console.log('1. Install ngrok: brew install ngrok (if not installed)');
        console.log('2. Get auth token: https://dashboard.ngrok.com/get-started/your-authtoken');
        console.log('3. Set token: ngrok authtoken YOUR_TOKEN');
        console.log('4. Test manually: ngrok http 3001');
        console.log('5. Use the generated URL instead of the button');
        
        return false;
    }
}

// Run the fix
fixNgrok().then((success) => {
    if (success) {
        console.log('\n🎊 Ready to go! Your TikTok Live Connector can now go public!');
    } else {
        console.log('\n📞 Need help? The manual method always works:');
        console.log('   Terminal: ngrok http 3001');
        console.log('   Then use the generated URL');
    }
    process.exit(0);
});
