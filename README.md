# Careech Admin Panel - Separate Domain

## 🔒 Security Architecture

The admin panel is deployed as a **separate Cloudflare Workers application** on its own domain for enhanced security:

### **Why Separate Domain?**

1. **🔐 Security Isolation** - Admin interface completely separated from public application
2. **🚫 Reduced Attack Surface** - Attackers can't discover admin routes through main app
3. **🛡️ IP Whitelisting** - Can restrict admin domain to specific IPs/networks
4. **🔑 Different Authentication** - Admin uses separate JWT secrets and sessions
5. **📊 Independent Scaling** - Admin panel scales independently from main app
6. **🔍 Audit Trail** - Separate logs and monitoring for admin actions

### **Deployment Architecture**

```
Main App (careech.pages.dev)
├── Public routes (/,  /login, /candidate, /recruiter, /dashboard, /v/:slug)
├── Candidate API (/api/candidate/*)
├── Recruiter API (/api/recruiter/*)
└── User Auth API (/api/auth/*)

Admin App (careech-admin.pages.dev)
├── Admin routes (/login, /)
├── Admin API (/api/admin/*)
└── Shares same D1 database (read-only for viewing data)
```

## 🚀 Deployment

### **1. Deploy Main App First**

```bash
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name careech
```

### **2. Deploy Admin App to Separate Domain**

```bash
cd /home/user/webapp-admin
npm run build
npx wrangler pages deploy dist --project-name careech-admin
```

This creates TWO separate domains:
- `https://careech.pages.dev` - Main application
- `https://careech-admin.pages.dev` - Admin panel

### **3. Configure Database Access**

Both apps need access to the same D1 database. In `wrangler.jsonc` for both:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "careech-production",
      "database_id": "<same-database-id-for-both>"
    }
  ]
}
```

### **4. Set Environment Variables**

**Main App (`careech`):**
```bash
npx wrangler pages secret put OPENAI_API_KEY --project-name careech
npx wrangler pages secret put JWT_SECRET --project-name careech
```

**Admin App (`careech-admin`):**
```bash
npx wrangler pages secret put JWT_SECRET --project-name careech-admin
npx wrangler pages secret put MAIN_APP_URL --project-name careech-admin
# Set to: https://careech.pages.dev
```

## 🔐 Additional Security Measures

### **1. IP Whitelisting (Cloudflare)**

Add Cloudflare Firewall rules to restrict admin domain:

```
If:
  Hostname equals careech-admin.pages.dev
  AND IP address is not in [your-office-ips]
Then:
  Block
```

### **2. Custom Admin Domain**

Use a non-obvious subdomain:

```bash
# Instead of admin.careech.com, use something like:
npx wrangler pages domain add secure-portal-2024.careech.com --project-name careech-admin
```

### **3. Additional Authentication**

- Enable 2FA for admin users
- Implement rate limiting on login endpoint
- Add CAPTCHA for login form
- Log all admin actions to audit trail

### **4. Network Security**

- Use Cloudflare Access for additional layer
- Require VPN connection for admin access
- Set up alerts for failed login attempts

## 📊 Database Sharing

Both apps share the same D1 database but:

**Main App:**
- ✅ Full read/write access
- Creates candidates, verifications, job posts
- Manages user sessions

**Admin App:**
- ✅ Read-only for viewing data
- Read/write for admin sessions only
- No ability to modify candidate data (view-only)

## 🧪 Local Development

For local development, you can run both on different ports:

```bash
# Terminal 1 - Main App (port 3000)
cd /home/user/webapp
npm run build
pm2 start ecosystem.config.cjs

# Terminal 2 - Admin App (port 3001)
cd /home/user/webapp-admin
npm run build
pm2 start ecosystem.config.cjs
```

Access:
- Main App: http://localhost:3000
- Admin Panel: http://localhost:3001

## 📝 Production URLs

After deployment:

**Main Application:**
- Homepage: `https://careech.pages.dev`
- Candidate Login: `https://careech.pages.dev/login?type=candidate`
- Recruiter Login: `https://careech.pages.dev/login?type=recruiter`
- Dashboard: `https://careech.pages.dev/dashboard`

**Admin Panel:**
- Admin Login: `https://careech-admin.pages.dev/login`
- Admin Dashboard: `https://careech-admin.pages.dev/`

## 🛡️ Security Checklist

Before going to production:

- [ ] Change default admin password
- [ ] Set strong JWT_SECRET for both apps
- [ ] Configure IP whitelisting on admin domain
- [ ] Enable Cloudflare Web Application Firewall (WAF)
- [ ] Set up monitoring and alerts
- [ ] Configure rate limiting
- [ ] Enable 2FA for admin users
- [ ] Set up audit logging
- [ ] Use custom subdomain (not "admin")
- [ ] Test with security scanning tools

## 🔄 Updates

When updating code:

1. **Update Main App:**
   ```bash
   cd /home/user/webapp
   git pull
   npm run deploy
   ```

2. **Update Admin App:**
   ```bash
   cd /home/user/webapp-admin
   git pull
   npm run deploy
   ```

Both can be updated independently without affecting each other.

## 📞 Emergency Access

If admin panel is locked down:

1. Temporarily disable IP restrictions in Cloudflare
2. Use Wrangler CLI to create new admin user:
   ```bash
   npx wrangler d1 execute careech-production \
     --command="INSERT INTO admin_users (username, password_hash, full_name, is_active) VALUES ('emergency', '<hash>', 'Emergency Admin', 1)"
   ```

## 🎯 Benefits Summary

| Feature | Benefit |
|---------|---------|
| Separate Domain | Hidden from public, harder to discover |
| Independent Deployment | Update admin without affecting users |
| IP Whitelisting | Restrict to office/VPN only |
| Different Auth | Separate JWT secrets, isolated sessions |
| Audit Trail | Dedicated logs for admin actions |
| Cloudflare Access | Additional authentication layer |
| Rate Limiting | Protect against brute force |
| No Public Links | Admin routes not indexed by search engines |

---

**Built with security-first architecture using Cloudflare Workers and D1**
