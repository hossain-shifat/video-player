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
    let token;
    try {
        const loginRes = await postJson('http://localhost:5000/api/auth/login', { email: 'admin@flux.com', password: 'admin123' });
        token = loginRes.token;
    } catch(e) {
        const loginRes = await postJson('http://localhost:5000/api/auth/login', { email: 'hossainshifat222@gmail.com', password: 'Admin@123456' });
        token = loginRes.token;
    }
    
    const media = await fetchJson('http://localhost:5000/api/media', { Authorization: 'Bearer ' + token });
    
    // Test a movie
    const movieId = media.movies.items[0].id;
    console.log(`Testing Movie ID: ${movieId}`);
    const stream1 = await fetchJson(`http://localhost:5000/stream/video/${movieId}?info=1`, { Authorization: 'Bearer ' + token });
    console.log('Stream Info:', stream1);

    // Test a series episode
    const series = media.series.items[0];
    const details = await fetchJson(`http://localhost:5000/api/media/${series.id}`, { Authorization: 'Bearer ' + token });
    const epId = details.seasons[0].episodes[0].raw.id;
    console.log(`Testing Episode ID: ${epId}`);
    const stream2 = await fetchJson(`http://localhost:5000/stream/video/${epId}?info=1`, { Authorization: 'Bearer ' + token });
    console.log('Stream Info:', stream2);
    
    // Simulate playing the episode and recording history
    const historyRes = await postJson(`http://localhost:5000/api/history/${epId}`, {
        name: details.seasons[0].episodes[0].name,
        type: 'series',
        position: 15,
        duration: NaN,
        streamUrl: stream2.streamUrl
    });
    console.log('History saved:', historyRes);

})();
