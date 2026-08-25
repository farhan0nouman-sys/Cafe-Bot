// Serverless entry point. Vercel treats a default export from api/ as the request
// handler, and an Express app is already a (req, res) handler, so it hands every
// request straight to the same app `npm start` runs locally.
//
// Everything routes through here rather than letting the platform serve frontend/
// as static files: the staff password is enforced by Express middleware, and static
// hosting would serve staff.html around it.

import app from '../backend/server.js';

export default app;
