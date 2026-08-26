# RASSLENE — Dark Art Gallery

A minimal full-stack starter for Rasslene: drawings, paintings, crafts and handmade creations. It includes a responsive public gallery, artwork detail/reviews, moderation, uploads and SQLite storage.

## Run
1. Install Node.js 20+
2. Run `npm install`
3. Run `npm start`
4. Open `http://localhost:3000`

The database `gallery.db` is created automatically. Uploaded images go to `public/uploads`.

## API
- `GET /api/works?category=ALL|DRAWINGS|PAINTINGS|CRAFTS`
- `GET /api/works/:id`
- `POST /api/works` (multipart/form-data)
- `PUT /api/works/:id`
- `DELETE /api/works/:id`
- `POST /api/reviews`
- `GET /api/admin/reviews`
- `PATCH /api/admin/reviews/:id` with `{"action":"approve"}` or any other action to delete

## Production note
Add real admin authentication, CSRF protection, rate limiting, image validation/storage, email delivery for contact messages, and an admin UI before public deployment.
