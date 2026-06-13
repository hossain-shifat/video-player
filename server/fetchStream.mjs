import http from 'http';

async function test() {
    const loginData = JSON.stringify({ email: 'hossainshifat222@gmail.com', password: 'Admin@123456' });
    const req = http.request('http://localhost:5000/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginData)
        }
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            const data = JSON.parse(body);
            if (!data.token) {
                console.log('Login failed', data);
                return;
            }
            console.log('Logged in successfully.');
            
            http.get('http://localhost:5000/api/media', { headers: { 'Authorization': `Bearer ${data.token}` } }, (res2) => {
                let body2 = '';
                res2.on('data', chunk => body2 += chunk);
                res2.on('end', () => {
                    const media = JSON.parse(body2);
                    const videoId = media.movies.items[0].id;
                    console.log('Found video:', videoId);
                    
                    http.get(`http://localhost:5000/stream/video/${videoId}?info=1`, { headers: { 'Authorization': `Bearer ${data.token}` } }, (res3) => {
                        let body3 = '';
                        res3.on('data', chunk => body3 += chunk);
                        res3.on('end', () => {
                            const streamInfo = JSON.parse(body3);
                            console.log('Stream info:', streamInfo);
                        });
                    });
                });
            });
        });
    });
    
    req.write(loginData);
    req.end();
}

test();
