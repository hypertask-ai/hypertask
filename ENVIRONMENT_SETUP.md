# Production-Grade JWT Email Authentication Setup

## 🚀 **What We've Built**

A **production-grade email authentication system** that follows industry best practices:

- ✅ **JWT tokens** with cryptographic signing
- ✅ **15-minute expiration** for security
- ✅ **Proper issuer/audience validation**
- ✅ **Scalable** across multiple server instances
- ✅ **No in-memory storage** (stateless)
- ✅ **Firebase integration** maintained

## 🔧 **Required Environment Variables**

Add these to your `.env.local` file:

```bash
# JWT Configuration (REQUIRED)
JWT_SECRET=your_super_secret_random_string_here_min_32_chars
JWT_ISSUER=hypertask
JWT_AUDIENCE=email-link

# App Configuration
NEXT_PUBLIC_SITE_URL=https://app.hypertask.ai

# Resend Configuration (REQUIRED for email delivery)
RESEND_API_KEY=your_resend_api_key
EMAIL_FROM=noreply@hypertask.ai
```

## 🔐 **JWT_SECRET Generation**

Generate a secure random string:

```bash
# Option 1: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Option 2: Using OpenSSL
openssl rand -hex 32

# Option 3: Online generator (less secure)
# https://generate-secret.vercel.app/32
```

## 📧 **Resend Setup**

### **1. Create Resend Account**
- Go to [resend.com](https://resend.com)
- Sign up for an account

### **2. Get API Key**
- Go to API Keys
- Create a new API key
- Copy the API key

### **3. Verify Sender Domain** (Optional but recommended)
- Go to Domains
- Verify the domain used by `EMAIL_FROM`

### **4. Test the Integration**
- Enter your email in the login form
- Check your inbox for the sign-in link
- Click the link to test authentication

## 🧪 **Testing the System**

1. **Set environment variables** in `.env.local`
2. **Restart your dev server**
3. **Enter email** in login form
4. **Check console** for dev link (in development)
5. **Click link** to test authentication

## 🔒 **Security Features**

- **JWT tokens expire in 15 minutes**
- **Cryptographic signing** prevents tampering
- **Issuer/audience validation** prevents token reuse
- **Stateless design** scales across instances
- **No sensitive data in tokens**

## 🔑 **BYOK (Bring Your Own Key) Configuration**

BYOK allows teams on the BYOK plan to supply their own AI provider API keys. Keys are stored AES-256-GCM encrypted in the database.

### Required Environment Variable

```bash
# 32-byte hex secret — shared between Next.js and FastAPI for encryption/decryption
BYOK_CIPHER_SECRET=your_64_char_hex_string_here
```

### Generating the Secret

```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> The same value must be set in your FastAPI environment so it can decrypt keys at inference time.

### Encryption Format

`[1 byte version=0x01][12 byte IV][16 byte GCM tag][ciphertext...]` — base64-encoded.

Python decryption:
```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import hashlib, base64
key = hashlib.sha256(BYOK_CIPHER_SECRET.encode()).digest()
# parse v1 blob, then: AESGCM(key).decrypt(iv, ciphertext_with_tag, None)
```

---

## 🚨 **Production Checklist**

- [ ] **JWT_SECRET** is at least 32 characters
- [ ] **BYOK_CIPHER_SECRET** is set and matches FastAPI config
- [ ] **HTTPS** is enabled in production
- [ ] **Rate limiting** is implemented
- [ ] **Email provider** is configured
- [ ] **Environment variables** are set in production
- [ ] **Dev links are disabled** in production

## 🔍 **Troubleshooting**

### **"Missing JWT_SECRET env var"**
- Check your `.env.local` file
- Ensure JWT_SECRET is set and not empty

### **"JWT verification failed"**
- Token has expired (15 minutes)
- Invalid JWT_SECRET
- Token was tampered with

### **"Failed to send email"**
- Check Resend configuration
- Verify email credentials
- Check email provider limits

## 📚 **Industry Standards Followed**

- [Auth0 Token Best Practices](https://auth0.com/docs/secure/tokens/token-best-practices)
- [API Authentication Security Best Practices](https://www.impart.security/api-security-best-practices/api-authentication-security-best-practices)
- OAuth 2.0 and JWT standards
- Firebase security best practices
