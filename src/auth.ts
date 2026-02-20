// Edge-compatible authentication service using Web Crypto API
export class AuthService {
  private jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }

  // Simple password hashing using Web Crypto API
  async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Verify password
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    const passwordHash = await this.hashPassword(password);
    return passwordHash === hash;
  }

  // Generate JWT-like token (unified for all user types)
  generateToken(userId: number, identifier: string, userType: string = 'admin', expiresIn: string = '24h'): string {
    const hours = expiresIn === '7d' ? 168 : 24;
    const expiresAt = Date.now() + (hours * 60 * 60 * 1000);
    
    const payload = {
      userId,
      identifier, // username for admin, email for users
      userType, // 'admin', 'candidate', or 'recruiter'
      exp: expiresAt
    };
    
    const token = btoa(JSON.stringify(payload)) + '.' + this.createSignature(payload);
    return token;
  }

  // Verify JWT-like token (unified)
  verifyToken(token: string): { userId: number; identifier: string; userType: string } | null {
    try {
      const [payloadB64, signature] = token.split('.');
      const payload = JSON.parse(atob(payloadB64));
      
      // Check expiration
      if (payload.exp < Date.now()) {
        return null;
      }
      
      // Verify signature
      const expectedSignature = this.createSignature(payload);
      if (signature !== expectedSignature) {
        return null;
      }
      
      return {
        userId: payload.userId,
        identifier: payload.identifier,
        userType: payload.userType
      };
    } catch (error) {
      return null;
    }
  }

  // Create simple signature
  private createSignature(payload: any): string {
    const data = JSON.stringify(payload) + this.jwtSecret;
    const encoder = new TextEncoder();
    const hash = Array.from(encoder.encode(data))
      .reduce((acc, byte) => acc + byte, 0);
    return hash.toString(36);
  }

  // Create token hash for database storage
  async createTokenHash(token: string): Promise<string> {
    return await this.hashPassword(token);
  }
}

// Middleware to verify admin authentication
export async function verifyAdminAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Verify JWT token
  const authService = new AuthService(c.env.JWT_SECRET || 'careech-secret-key-change-in-production');
  const decoded = authService.verifyToken(token);
  
  if (!decoded || decoded.userType !== 'admin') {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }

  // Check if user is active
  const user = await c.env.DB.prepare(`
    SELECT * FROM admin_users WHERE id = ? AND is_active = 1
  `).bind(decoded.userId).first();

  if (!user) {
    return c.json({ error: 'Unauthorized - User inactive' }, 401);
  }

  // Store admin info in context
  c.set('adminId', decoded.userId);
  c.set('adminUsername', decoded.identifier);

  await next();
}

// Middleware to verify user authentication (candidates and recruiters)
export async function verifyUserAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized - No token provided' }, 401);
  }

  const token = authHeader.substring(7);
  
  // Verify JWT token
  const authService = new AuthService(c.env.JWT_SECRET || 'careech-secret-key-change-in-production');
  const decoded = authService.verifyToken(token);
  
  if (!decoded || (decoded.userType !== 'candidate' && decoded.userType !== 'recruiter')) {
    return c.json({ error: 'Unauthorized - Invalid token' }, 401);
  }

  // Check if user is active
  const user = await c.env.DB.prepare(`
    SELECT * FROM users WHERE id = ? AND is_active = 1
  `).bind(decoded.userId).first();

  if (!user) {
    return c.json({ error: 'Unauthorized - User inactive' }, 401);
  }

  // Store user info in context
  c.set('userId', decoded.userId);
  c.set('userEmail', decoded.identifier);
  c.set('userType', decoded.userType);

  await next();
}

// Middleware to verify candidate authentication
export async function verifyCandidateAuth(c: any, next: any) {
  await verifyUserAuth(c, async () => {
    if (c.get('userType') !== 'candidate') {
      return c.json({ error: 'Unauthorized - Candidates only' }, 403);
    }
    await next();
  });
}

// Middleware to verify recruiter authentication
export async function verifyRecruiterAuth(c: any, next: any) {
  await verifyUserAuth(c, async () => {
    if (c.get('userType') !== 'recruiter') {
      return c.json({ error: 'Unauthorized - Recruiters only' }, 403);
    }
    await next();
  });
}
