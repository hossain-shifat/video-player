import { chromium } from 'playwright';
import http from 'http';

const fetchJson = (url, headers = {}) => new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
        });
    }).on('error', reject);
});

const postJson = (url, data) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch(e) { reject(e); }
        });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
});

(async () => {
    console.log('Logging in...');
    let token;
    try {
        const loginRes = await postJson('http://localhost:5000/api/auth/login', { email: 'hossainshifat222@gmail.com', password: 'Admin@123456' });
        if (!loginRes.token) throw new Error('Login failed: ' + JSON.stringify(loginRes));
        token = loginRes.token;
    } catch(e) {
        // Fallback
        const loginRes = await postJson('http://localhost:5000/api/auth/login', { email: 'admin@flux.com', password: 'admin123' });
        token = loginRes.token;
    }
    
    console.log('Fetching media library...');
    const media = await fetchJson('http://localhost:5000/api/media', { Authorization: 'Bearer ' + token });
    
    const testItems = [];
    // 3 Movies
    for (let i=0; i<Math.min(3, media.movies.items.length); i++) {
        testItems.push({ type: 'movie', name: media.movies.items[i].name, id: media.movies.items[i].id });
    }
    // 3 Series (Episodes)
    // Wait, to get an episode ID, we need to fetch the series details!
    for (let i=0; i<Math.min(3, media.series.items.length); i++) {
        const series = media.series.items[i];
        const details = await fetchJson(`http://localhost:5000/api/media/${encodeURIComponent(series.id)}`, { Authorization: 'Bearer ' + token });
        if (details.seasons && details.seasons.length > 0) {
            const firstSeason = details.seasons[0];
            const firstEp = firstSeason.episodes[0];
            testItems.push({ type: 'series', name: series.name + ' ' + firstEp.name, id: firstEp.id });
        }
    }
    
    console.log('Testing items:', testItems.map(t => t.name));

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process', '--js-flags="--max-old-space-size=1024"']
    });
    const context = await browser.newContext();
    
    const finalReport = [];

    for (const item of testItems) {
        console.log(`\n============================`);
        console.log(`Testing [${item.type}] ${item.name}`);
        console.log(`ID: ${item.id}`);
        console.log(`============================`);
        
        const page = await context.newPage();
        const errors = [];
        const hlsChunks = [];
        let videoError = null;
        let isSuccess = false;
        
        page.on('console', msg => {
            if (msg.type() === 'error') errors.push('Console: ' + msg.text());
        });
        page.on('response', response => {
            const u = response.url();
            if (u.includes('.ts') || u.includes('.m3u8')) {
                if (!u.includes('.m3u8')) hlsChunks.push(u);
                if (!response.ok()) errors.push(`HTTP ${response.status()} on ${u}`);
            }
        });
        
        try {
            await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
            
            // Log in if needed
            const btn = await page.$('button:has-text("Sign In")');
            if (btn) {
                await btn.click();
                await page.fill('input[type="email"]', 'admin@flux.com');
                await page.fill('input[type="password"]', 'admin123');
                await page.click('button[type="submit"]');
                await page.waitForTimeout(1000);
            }

            await page.goto(`http://localhost:5173/player/${encodeURIComponent(item.id)}`, { waitUntil: 'domcontentloaded' });
            
            for (let t=0; t<15; t++) {
                await page.waitForTimeout(1000);
                const vs = await page.evaluate(() => {
                    const v = document.querySelector('video');
                    if (!v) return null;
                    return { error: v.error ? v.error.message : null, time: v.currentTime };
                });
                if (vs && vs.error) {
                    videoError = vs.error;
                    break;
                }
                if (vs && vs.time > 1) {
                    isSuccess = true;
                    break;
                }
            }
            
            finalReport.push({
                name: item.name,
                type: item.type,
                chunksGenerated: hlsChunks.length,
                videoError,
                isSuccess,
                errors
            });
            
        } catch(e) {
            errors.push('Script error: ' + e.message);
            finalReport.push({ name: item.name, chunksGenerated: 0, videoError: 'CRASH', errors, isSuccess: false });
        } finally {
            await page.close();
        }
    }
    
    await browser.close();
    
    console.log('\n--- FINAL REPORT ---');
    console.log(JSON.stringify(finalReport, null, 2));

    // Check history
    const history = await fetchJson('http://localhost:5000/api/history', { Authorization: 'Bearer ' + token });
    console.log('\n--- HISTORY STATUS ---');
    console.log(`Total history entries: ${history.total}`);
    if (history.total > 0) {
        console.log(`Latest entry ID: ${history.history[0].id}`);
        console.log(`Latest entry duration: ${history.history[0].duration}`);
        console.log(`Latest entry position: ${history.history[0].position}`);
    }

})();
