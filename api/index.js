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

    // Helpers
    async function getDB() {
        const getRes = await fetch(codesUrl, {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Vercel-App' }
        });
        if (!getRes.ok) throw new Error('GitHub read failed');
        const fileData = await getRes.json();
        const db = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
        if (!db.products) db.products = {};
        if (!db.activity) db.activity = [];
        return { db, sha: fileData.sha };
    }

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
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }

    function logActivity(db, description) {
        if (!db.activity) db.activity = [];
        db.activity.unshift({ timestamp: new Date().toISOString(), description });
        if (db.activity.length > 50) db.activity = db.activity.slice(0, 50); // Keep last 50
    }

    // === GET Endpoints ===
    if (req.method === 'GET') {
        try {
            // Get Products
            if (req.query.action === 'get-products') {
                const { db } = await getDB();
                return res.status(200).json({ products: Object.values(db.products) });
            }

            // Unlock Product
            if (req.query.action === 'unlock') {
                const { productId, code } = req.query;
                const { db, sha } = await getDB();
                if (!db.products[productId]) return res.status(404).json({ success: false, error: 'Product not found' });
                
                const product = db.products[productId];
                if (product.isSoldOut) return res.status(400).json({ success: false, error: 'Product sold out' });

                if (product.code === code) {
                    // Log download (optional: update a 'downloads' counter)
                    product.downloads = (product.downloads || 0) + 1;
                    logActivity(db, `Code used for ${product.name}`);
                    await updateDB(db, sha, `Unlock: ${product.name}`);
                    return res.status(200).json({ success: true, fileUrl: product.fileUrl });
                } else {
                    return res.status(401).json({ success: false, error: 'Invalid code' });
                }
            }

            // Get Stats
            if (req.query.action === 'get-stats') {
                const { db } = await getDB();
                const products = Object.values(db.products);
                const totalProducts = products.length;
                const totalUnlocks = products.reduce((sum, p) => sum + (p.downloads || 0), 0);
                const activeCodes = products.filter(p => !p.isSoldOut).length;
                return res.status(200).json({ totalProducts, totalUnlocks, activeCodes });
            }

            // Get Activity Log
            if (req.query.action === 'get-activity') {
                const { db } = await getDB();
                return res.status(200).json({ logs: db.activity || [] });
            }
        } catch (error) {
            return res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }

    // === POST Endpoints ===
    if (req.method === 'POST') {
        const { action, adminPassword } = req.body;
        try {
            const { db, sha } = await getDB();
            const storedPass = db.password || defaultPass;

            // Login
            if (action === 'login') {
                if (adminPassword === storedPass) return res.status(200).json({ success: true });
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // Check Auth for all other actions
            if (adminPassword !== storedPass) return res.status(401).json({ error: 'Unauthorized' });

            // Add/Edit Product
            if (action === 'add-product' || action === 'edit-product') {
                const { name, description, category, fileUrl, fileData, fileName } = req.body;
                if (!name) return res.status(400).json({ error: 'Name is required' });

                let finalFileUrl = fileUrl;
                if (fileData && fileName) finalFileUrl = await uploadFileToGitHub(fileName, fileData);
                if (!finalFileUrl) return res.status(400).json({ error: 'File URL or File is required' });

                if (action === 'add-product') {
                    const code = Array.from({length: 20}, () => Math.random().toString(36)[2]).join('').toUpperCase();
                    const productId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
                    db.products[productId] = { id: productId, name, description, category, fileUrl: finalFileUrl, code, isSoldOut: false, downloads: 0, createdAt: new Date().toISOString() };
                    logActivity(db, `Added product: ${name}`);
                    await updateDB(db, sha, `Add: ${name}`);
                    return res.status(200).json({ success: true, code, productId });
                } else {
                    const { productId } = req.body;
                    if (!db.products[productId]) return res.status(404).json({ error: 'Product not found' });
                    db.products[productId] = { ...db.products[productId], name, description, category, fileUrl: finalFileUrl };
                    logActivity(db, `Edited product: ${name}`);
                    await updateDB(db, sha, `Edit: ${name}`);
                    return res.status(200).json({ success: true });
                }
            }

            // Delete Product
            if (action === 'delete-product') {
                const { productId } = req.body;
                if (!db.products[productId]) return res.status(404).json({ error: 'Product not found' });
                const name = db.products[productId].name;
                delete db.products[productId];
                logActivity(db, `Deleted product: ${name}`);
                await updateDB(db, sha, `Delete: ${name}`);
                return res.status(200).json({ success: true });
            }

            // Toggle Status
            if (action === 'toggle-status') {
                const { productId, isSoldOut } = req.body;
                if (!db.products[productId]) return res.status(404).json({ error: 'Product not found' });
                db.products[productId].isSoldOut = isSoldOut;
                logActivity(db, `Marked ${db.products[productId].name} as ${isSoldOut ? 'Sold Out' : 'Available'}`);
                await updateDB(db, sha, `Status: ${isSoldOut}`);
                return res.status(200).json({ success: true });
            }

            // Change Password
            if (action === 'change-password') {
                const { newPassword } = req.body;
                if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password too short' });
                db.password = newPassword;
                logActivity(db, `Admin password changed`);
                await updateDB(db, sha, `Password changed`);
                return res.status(200).json({ success: true });
            }

        } catch (error) {
            return res.status(500).json({ error: 'Internal server error: ' + error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
