import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// DATABASE
// =========================

const db = new Database(path.join(__dirname, 'gallery.db'));

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS works(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK(category IN ('DRAWINGS','PAINTINGS','CRAFTS')),
    image TEXT,
    year INTEGER,
    materials TEXT,
    featured INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// =========================
// UPLOADS
// =========================

const uploadDir = path.join(__dirname, 'public/uploads');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
    dest: uploadDir
});

// =========================
// MIDDLEWARE
// =========================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'change-this-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax'
        }
    })
);

app.use(express.static(path.join(__dirname, 'public')));

// =========================
// AUTHENTICATION
// =========================

const ADMIN_USER = process.env.ADMIN_USER || 'rasslene';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';

function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    return res.status(401).json({
        error: 'Unauthorized'
    });
}

// Login
app.post('/api/admin/login', (req, res) => {

    const { username, password } = req.body;

    if (
        username === ADMIN_USER &&
        password === ADMIN_PASSWORD
    ) {
        req.session.isAdmin = true;

        return res.json({
            ok: true
        });
    }

    res.status(401).json({
        error: 'Invalid username or password'
    });
});

// Logout
app.post('/api/admin/logout', (req, res) => {

    req.session.destroy(() => {
        res.json({
            ok: true
        });
    });

});

// Check login
app.get('/api/admin/me', (req, res) => {

    res.json({
        authenticated: !!(req.session && req.session.isAdmin)
    });

});

// =========================
// PUBLIC WORKS API
// =========================

const workPayload = w => ({
    ...w,
    featured: !!w.featured
});

// Get all works
app.get('/api/works', (req, res) => {

    const cat = req.query.category;

    let rows;

    if (cat && cat !== 'ALL') {

        rows = db
            .prepare(`
                SELECT *
                FROM works
                WHERE category=?
                ORDER BY featured DESC, created_at DESC
            `)
            .all(cat);

    } else {

        rows = db
            .prepare(`
                SELECT *
                FROM works
                ORDER BY featured DESC, created_at DESC
            `)
            .all();

    }

    rows = rows.map(r => ({
        ...workPayload(r),
        rating: db
            .prepare(`
                SELECT
                    ROUND(AVG(rating),1) rating,
                    COUNT(*) count
                FROM reviews
                WHERE work_id=?
                AND approved=1
            `)
            .get(r.id)
    }));

    res.json(rows);
});

// Get one work
app.get('/api/works/:id', (req, res) => {

    const w = db
        .prepare('SELECT * FROM works WHERE id=?')
        .get(req.params.id);

    if (!w) {
        return res.status(404).json({
            error: 'Not found'
        });
    }

    const stats = db
        .prepare(`
            SELECT
                ROUND(AVG(rating),1) rating,
                COUNT(*) count
            FROM reviews
            WHERE work_id=?
            AND approved=1
        `)
        .get(w.id);

    const reviews = db
        .prepare(`
            SELECT
                id,
                client_name,
                rating,
                comment,
                created_at
            FROM reviews
            WHERE work_id=?
            AND approved=1
            ORDER BY created_at DESC
        `)
        .all(w.id);

    res.json({
        ...workPayload(w),
        stats,
        reviews
    });

});

// =========================
// ADMIN WORKS
// =========================

// Add work
app.post(
    '/api/works',
    requireAdmin,
    upload.single('image'),
    (req, res) => {

        const {
            title,
            description,
            category,
            year,
            materials,
            featured
        } = req.body;

        if (!title || !category) {
            return res.status(400).json({
                error: 'Title and category are required'
            });
        }

        const image = req.file
            ? '/uploads/' + req.file.filename
            : '';

        const info = db
            .prepare(`
                INSERT INTO works
                (
                    title,
                    description,
                    category,
                    image,
                    year,
                    materials,
                    featured
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                title,
                description || '',
                category,
                image,
                year || null,
                materials || '',
                featured ? 1 : 0
            );

        res.json({
            ok: true,
            id: info.lastInsertRowid
        });

    }
);

// Update work
app.put(
    '/api/works/:id',
    requireAdmin,
    (req, res) => {

        const {
            title,
            description,
            category,
            year,
            materials,
            featured,
            image
        } = req.body;

        db.prepare(`
            UPDATE works
            SET
                title=?,
                description=?,
                category=?,
                year=?,
                materials=?,
                featured=?,
                image=COALESCE(?, image)
            WHERE id=?
        `).run(
            title,
            description,
            category,
            year || null,
            materials || '',
            featured ? 1 : 0,
            image || null,
            req.params.id
        );

        res.json({
            ok: true
        });

    }
);

// Delete work
app.delete(
    '/api/works/:id',
    requireAdmin,
    (req, res) => {

        db.prepare(
            'DELETE FROM works WHERE id=?'
        ).run(req.params.id);

        res.json({
            ok: true
        });

    }
);

// =========================
// REVIEWS
// =========================

// Public submit review
app.post('/api/reviews', (req, res) => {

    const {
        work_id,
        client_name,
        rating,
        comment
    } = req.body;

    if (
        !work_id ||
        !client_name ||
        !rating ||
        !comment
    ) {
        return res.status(400).json({
            error: 'All fields are required'
        });
    }

    db.prepare(`
        INSERT INTO reviews
        (
            work_id,
            client_name,
            rating,
            comment,
            approved
        )
        VALUES (?, ?, ?, ?, 0)
    `).run(
        work_id,
        client_name,
        Number(rating),
        comment
    );

    res.json({
        ok: true,
        message: 'Review submitted for moderation.'
    });

});

// Admin reviews
app.get(
    '/api/admin/reviews',
    requireAdmin,
    (req, res) => {

        const reviews = db
            .prepare(`
                SELECT
                    r.*,
                    w.title
                FROM reviews r
                JOIN works w
                ON w.id=r.work_id
                ORDER BY r.created_at DESC
            `)
            .all();

        res.json(reviews);

    }
);

// Approve / delete review
app.patch(
    '/api/admin/reviews/:id',
    requireAdmin,
    (req, res) => {

        if (req.body.action === 'approve') {

            db.prepare(`
                UPDATE reviews
                SET approved=1
                WHERE id=?
            `).run(req.params.id);

        } else {

            db.prepare(`
                DELETE FROM reviews
                WHERE id=?
            `).run(req.params.id);

        }

        res.json({
            ok: true
        });

    }
);

// =========================
// ADMIN PAGE
// =========================

app.get('/admin', (req, res) => {

    res.sendFile(
        path.join(__dirname, 'public/admin.html')
    );

});

// =========================
// FRONTEND FALLBACK
// =========================

app.use((req, res) => {

    res.sendFile(
        path.join(__dirname, 'public/index.html')
    );

});

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {

    console.log(
        `Rasslene Gallery running at http://localhost:${PORT}`
    );

});