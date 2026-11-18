// api/index.js
const GITHUB_API = (owner, repo, path) => `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    const defaultPass = process.env.ADMIN_PASSWORD || 'mklopmklop';

    if (!token || !owner || !repo) {
        return res.status(500).json({ error: 'Server configuration error (Env Vars missing)' });
    }

    const codesUrl = `${GITHUB_API(owner, repo, 'codes.json')}?ref=${branch}`;

    // === 1. التحقق من الكود (للعميل) ===
    if (req.method === 'GET' && req.query.code) {
        const code = req.query.code.toUpperCase();
        try {
            const getRes = await fetch(codesUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
            });
            if (!getRes.ok) throw new Error('GitHub read failed');
            const fileData = await getRes.json();
            const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));

            const fileInfo = db.files ? db.files[code] : db[code];
            if (!fileInfo) return res.status(404).json({ success: false, error: 'Invalid code' });

            return res.status(200).json({
                success: true,
                fileName: fileInfo.fileName,
                downloadUrl: fileInfo.fileUrl
            });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // === 2. تسجيل دخول الأدمن ===
    if (req.method === 'POST' && req.body.action === 'login') {
        const { adminPassword } = req.body;
        try {
            const getRes = await fetch(codesUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
            });
            const fileData = await getRes.json();
            const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
            const storedPass = db.password || defaultPass;
            
            if (adminPassword === storedPass) {
                return res.status(200).json({ success: true });
            } else {
                return res.status(401).json({ error: 'Unauthorized' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // === 3. إضافة ملف (للأدمن) ===
    if (req.method === 'POST' && req.body.action === 'add-file') {
        const { adminPassword, fileName, fileUrl } = req.body;

        try {
            const getRes = await fetch(codesUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
            });
            const fileData = await getRes.json();
            const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));

            const storedPass = db.password || defaultPass;
            if (adminPassword !== storedPass) return res.status(401).json({ error: 'Unauthorized' });

            if (!fileName || !fileUrl) return res.status(400).json({ error: 'Missing data' });

            const code = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            if (!db.files) db.files = {};
            db.files[code] = {
                fileName: fileName,
                fileUrl: fileUrl,
                createdAt: new Date().toISOString()
            };

            const updateRes = await fetch(GITHUB_API(owner, repo, 'codes.json'), {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Vercel-App'
                },
                body: JSON.stringify({
                    message: `Add file: ${fileName} (Code: ${code})`,
                    content: Buffer.from(JSON.stringify(db, null, 2)).toString('base64'),
                    sha: fileData.sha,
                    branch: branch
                })
            });

            if (!updateRes.ok) throw new Error('GitHub write failed');
            return res.status(200).json({ success: true, code: code });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // === 4. تغيير الباسورد (للأدمن) ===
    if (req.method === 'POST' && req.body.action === 'change-password') {
        const { adminPassword, newPassword } = req.body;

        try {
            const getRes = await fetch(codesUrl, {
                headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
            });
            const fileData = await getRes.json();
            const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));

            const storedPass = db.password || defaultPass;
            if (adminPassword !== storedPass) return res.status(401).json({ error: 'Unauthorized' });
            if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });

            db.password = newPassword;

            const updateRes = await fetch(GITHUB_API(owner, repo, 'codes.json'), {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Vercel-App'
                },
                body: JSON.stringify({
                    message: `Password changed`,
                    content: Buffer.from(JSON.stringify(db, null, 2)).toString('base64'),
                    sha: fileData.sha,
                    branch: branch
                })
            });

            if (!updateRes.ok) throw new Error('GitHub write failed');
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
