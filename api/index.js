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

    // Helper: Get DB
    async function getDB() {
        const getRes = await fetch(codesUrl, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
        });
        if (!getRes.ok) throw new Error('GitHub read failed');
        const fileData = await getRes.json();
        const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
        return { db, sha: fileData.sha };
    }

    // Helper: Update DB
    async function updateDB(db, sha, message) {
        const updateRes = await fetch(GITHUB_API(owner, repo, 'codes.json'), {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Vercel-App'
            },
            body: JSON.stringify({
                message: message,
                content: Buffer.from(JSON.stringify(db, null, 2)).toString('base64'),
                sha: sha,
                branch: branch
            })
        });
        if (!updateRes.ok) throw new Error('GitHub write failed');
    }

    // Helper: Upload File to GitHub
    async function uploadFileToGitHub(fileName, base64Content) {
        const filePath = `files/${Date.now()}-${fileName}`;
        const uploadUrl = GITHUB_API(owner, repo, filePath);
        
        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Vercel-App'
            },
            body: JSON.stringify({
                message: `Upload file: ${fileName}`,
                content: base64Content,
                branch: branch
            })
        });
        
        if (!uploadRes.ok) throw new Error('Failed to upload file to GitHub');
        const data = await uploadRes.json();
        // Raw download link
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    // === 1. جلب المنتجات (للعميل والأدمن) ===
    if (req.method === 'GET' && req.query.action === 'get-products') {
        try {
            const { db } = await getDB();
            const productsList = db.products ? Object.values(db.products) : [];
            return res.status(200).json({ products: productsList });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // === 2. فتح منتج بالكود (للعميل) ===
    if (req.method === 'GET' && req.query.action === 'unlock') {
        const { productId, code } = req.query;
        try {
            const { db } = await getDB();
            if (!db.products || !db.products[productId]) return res.status(404).json({ success: false, error: 'Product not found' });
            
            const product = db.products[productId];
            if (product.code === code) {
                return res.status(200).json({ success: true, fileUrl: product.fileUrl });
            } else {
                return res.status(401).json({ success: false, error: 'Invalid code' });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // === 3. تسجيل دخول الأدمن ===
    if (req.method === 'POST' && req.body.action === 'login') {
        const { adminPassword } = req.body;
        try {
            const { db } = await getDB();
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

    // === 4. إضافة منتج (للأدمن) ===
    if (req.method === 'POST' && req.body.action === 'add-product') {
        const { adminPassword, name, description, fileUrl, fileData, fileName } = req.body;

        try {
            const { db, sha } = await getDB();
            const storedPass = db.password || defaultPass;
            if (adminPassword !== storedPass) return res.status(401).json({ error: 'Unauthorized' });

            if (!name) return res.status(400).json({ error: 'Name is required' });

            let finalFileUrl = fileUrl;

            // لو فيه ملف مرفوع، نرفعه على جيت هب
            if (fileData && fileName) {
                finalFileUrl = await uploadFileToGitHub(fileName, fileData);
            }

            if (!finalFileUrl) return res.status(400).json({ error: 'File URL or File is required' });

            // توليد كود 20 حرف/رقم
            const code = Array.from({length: 20}, () => Math.random().toString(36)[2]).join('').toUpperCase();
            const productId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

            if (!db.products) db.products = {};
            db.products[productId] = {
                id: productId,
                name,
                description,
                fileUrl: finalFileUrl,
                code,
                createdAt: new Date().toISOString()
            };

            await updateDB(db, sha, `Add product: ${name} (Code: ${code})`);
            return res.status(200).json({ success: true, code, productId });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }

    // === 5. تغيير الباسورد (للأدمن) ===
    if (req.method === 'POST' && req.body.action === 'change-password') {
        const { adminPassword, newPassword } = req.body;

        try {
            const { db, sha } = await getDB();
            const storedPass = db.password || defaultPass;
            if (adminPassword !== storedPass) return res.status(401).json({ error: 'Unauthorized' });
            if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });

            db.password = newPassword;
            await updateDB(db, sha, `Password changed`);
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
