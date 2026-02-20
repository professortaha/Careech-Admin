import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import { AuthService, verifyAdminAuth } from './auth';

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  MAIN_APP_URL: string; // URL of main app for CORS
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for API routes - allow main app domain
app.use('/api/*', async (c, next) => {
  const mainAppUrl = c.env.MAIN_APP_URL || 'https://careech.pages.dev';
  return cors({
    origin: [mainAppUrl, 'http://localhost:3000'],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })(c, next);
});

// Import HTML pages as modules
import adminLoginHTML from '../public/admin-login.html?raw';
import adminHTML from '../public/admin.html?raw';

// Serve admin login page
app.get('/login', (c) => {
  return c.html(adminLoginHTML);
});

// Serve admin dashboard (requires authentication)
app.get('/', (c) => {
  return c.html(adminHTML);
});

app.get('/admin', (c) => {
  return c.html(adminHTML);
});

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }));

// ============================================================================
// ADMIN AUTHENTICATION ROUTES
// ============================================================================

// Admin login endpoint
app.post('/api/admin/login', async (c) => {
  try {
    const { username, password, rememberMe } = await c.req.json();

    if (!username || !password) {
      return c.json({ success: false, error: 'Username and password are required' }, 400);
    }

    // Get admin user from database
    const admin = await c.env.DB.prepare(`
      SELECT * FROM admin_users WHERE username = ? AND is_active = 1
    `).bind(username).first();

    if (!admin) {
      return c.json({ success: false, error: 'Invalid username or password' }, 401);
    }

    // Verify password
    const authService = new AuthService(c.env.JWT_SECRET || 'careech-secret-key-change-in-production');
    const isValidPassword = await authService.verifyPassword(password, admin.password_hash as string);

    if (!isValidPassword) {
      return c.json({ success: false, error: 'Invalid username or password' }, 401);
    }

    // Generate JWT token
    const expiresIn = rememberMe ? '7d' : '24h';
    const token = authService.generateToken(admin.id as number, admin.username as string, 'admin', expiresIn);

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (rememberMe ? 7 : 1));

    // Store session in database
    const tokenHash = await authService.createTokenHash(token);
    await c.env.DB.prepare(`
      INSERT INTO admin_sessions (admin_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).bind(admin.id, tokenHash, expiresAt.toISOString()).run();

    // Update last login
    await c.env.DB.prepare(`
      UPDATE admin_users SET last_login = datetime('now') WHERE id = ?
    `).bind(admin.id).run();

    return c.json({
      success: true,
      token,
      username: admin.username,
      fullName: admin.full_name
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return c.json({ success: false, error: 'Login failed. Please try again.' }, 500);
  }
});

// Verify admin token
app.get('/api/admin/verify', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ valid: false, error: 'No token provided' }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthService(c.env.JWT_SECRET || 'careech-secret-key-change-in-production');
    
    // Verify JWT token
    const decoded = authService.verifyToken(token);
    
    if (decoded.userType !== 'admin') {
      return c.json({ valid: false, error: 'Invalid user type' }, 403);
    }

    // Check if session exists in database
    const tokenHash = await authService.createTokenHash(token);
    const session = await c.env.DB.prepare(`
      SELECT s.*, a.username, a.full_name, a.is_active
      FROM admin_sessions s
      JOIN admin_users a ON s.admin_id = a.id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND a.is_active = 1
    `).bind(tokenHash).first();

    if (!session) {
      return c.json({ valid: false, error: 'Session expired or invalid' }, 401);
    }

    return c.json({
      valid: true,
      username: session.username,
      fullName: session.full_name
    });
  } catch (error: any) {
    return c.json({ valid: false, error: error.message }, 401);
  }
});

// Admin logout endpoint
app.post('/api/admin/logout', verifyAdminAuth, async (c) => {
  try {
    const adminId = c.get('userId');
    
    // Delete all sessions for this admin
    await c.env.DB.prepare(`
      DELETE FROM admin_sessions WHERE admin_id = ?
    `).bind(adminId).run();

    return c.json({ success: true, message: 'Logged out successfully' });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================================================
// ADMIN DASHBOARD API ROUTES
// ============================================================================

// Get dashboard statistics
app.get('/api/admin/statistics', verifyAdminAuth, async (c) => {
  try {
    // Get total candidates
    const candidatesResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM candidates
    `).first();

    // Get verified profiles
    const verifiedResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM verifications WHERE is_active = 1
    `).first();

    // Get total jobs
    const jobsResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM job_posts
    `).first();

    // Get total matches
    const matchesResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM candidate_matches
    `).first();

    return c.json({
      total_candidates: candidatesResult?.count || 0,
      verified_profiles: verifiedResult?.count || 0,
      total_jobs: jobsResult?.count || 0,
      total_matches: matchesResult?.count || 0
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get all candidates
app.get('/api/admin/candidates', verifyAdminAuth, async (c) => {
  try {
    const candidates = await c.env.DB.prepare(`
      SELECT 
        c.*,
        v.id as verification_id,
        v.verification_slug,
        v.overall_confidence
      FROM candidates c
      LEFT JOIN verifications v ON c.id = v.candidate_id
      ORDER BY c.created_at DESC
    `).all();

    return c.json(candidates.results);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get candidate details
app.get('/api/admin/candidates/:uuid', verifyAdminAuth, async (c) => {
  try {
    const { uuid } = c.req.param();
    
    const candidate = await c.env.DB.prepare(`
      SELECT 
        c.*,
        v.id as verification_id,
        v.verification_slug,
        v.overall_confidence,
        v.verification_date
      FROM candidates c
      LEFT JOIN verifications v ON c.id = v.candidate_id
      WHERE c.uuid = ?
    `).bind(uuid).first();

    if (!candidate) {
      return c.json({ success: false, error: 'Candidate not found' }, 404);
    }

    return c.json(candidate);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get all verifications
app.get('/api/admin/verifications', verifyAdminAuth, async (c) => {
  try {
    const verifications = await c.env.DB.prepare(`
      SELECT 
        v.*,
        c.name,
        c.email,
        c.role_target
      FROM verifications v
      JOIN candidates c ON v.candidate_id = c.id
      ORDER BY v.verification_date DESC
    `).all();

    return c.json(verifications.results);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get verification details with skills
app.get('/api/admin/verifications/:id', verifyAdminAuth, async (c) => {
  try {
    const { id } = c.req.param();
    
    const verification = await c.env.DB.prepare(`
      SELECT 
        v.*,
        c.name,
        c.email,
        c.role_target,
        c.profile
      FROM verifications v
      JOIN candidates c ON v.candidate_id = c.id
      WHERE v.id = ?
    `).bind(id).first();

    if (!verification) {
      return c.json({ success: false, error: 'Verification not found' }, 404);
    }

    // Get verified skills
    const skills = await c.env.DB.prepare(`
      SELECT * FROM verified_skills WHERE verification_id = ?
    `).bind(id).all();

    return c.json({
      ...verification,
      skills: skills.results
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get all job posts
app.get('/api/admin/jobs', verifyAdminAuth, async (c) => {
  try {
    const jobs = await c.env.DB.prepare(`
      SELECT 
        j.*,
        COUNT(m.id) as match_count
      FROM job_posts j
      LEFT JOIN candidate_matches m ON j.id = m.job_id
      GROUP BY j.id
      ORDER BY j.created_at DESC
    `).all();

    return c.json(jobs.results);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get job details
app.get('/api/admin/jobs/:id', verifyAdminAuth, async (c) => {
  try {
    const { id } = c.req.param();
    
    const job = await c.env.DB.prepare(`
      SELECT * FROM job_posts WHERE id = ?
    `).bind(id).first();

    if (!job) {
      return c.json({ success: false, error: 'Job not found' }, 404);
    }

    return c.json(job);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get matches for a specific job
app.get('/api/admin/jobs/:id/matches', verifyAdminAuth, async (c) => {
  try {
    const { id } = c.req.param();
    
    const matches = await c.env.DB.prepare(`
      SELECT 
        m.*,
        c.name,
        c.email,
        c.role_target,
        v.verification_slug,
        v.overall_confidence
      FROM candidate_matches m
      JOIN candidates c ON m.candidate_id = c.id
      LEFT JOIN verifications v ON c.id = v.candidate_id
      WHERE m.job_id = ?
      ORDER BY m.match_score DESC
    `).bind(id).all();

    return c.json(matches.results);
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'careech-admin' });
});

export default app;
