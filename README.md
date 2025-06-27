# 🚀 Google Auth Service

A standalone Node.js service that handles Google OAuth authentication for React Native apps and interfaces with existing APIs.

## 🎯 **Simplified Configuration (Fixed Google OAuth Policy Issues)**

This service uses **web redirects only** to avoid Google OAuth policy restrictions:

- ✅ **No custom URL schemes** (avoids "URI invalide" errors)
- ✅ **Same redirect URI for development AND production**: `http://localhost:3001/auth/google/success`
- ✅ **Works with Google's OAuth 2.0 policies**
- ✅ **Mobile app uses WebBrowser for all environments**

## 🎯 **Quick Setup Summary**
1. **Google Cloud Console**: Add ONLY `http://localhost:3001/auth/google/success` as redirect URI
2. **Create .env**: Copy from .env.example and add your Google credentials
3. **Start service**: `npm start`
4. **Test mobile app**: Google login now works seamlessly

## 🎯 Purpose

This service acts as a bridge between your React Native app and the existing ticketing API:
- Handles Google OAuth flow securely
- Extracts user information from Google
- Automatically registers users with the existing ticketing API
- Returns access tokens for mobile app authentication

## 🏗️ Architecture

```
Mobile App → Google Auth Service → Existing Ticketing API
```

## 📋 Setup Instructions

### 1. Install Dependencies

```bash
cd google-auth-service
npm install
```

### 2. Create Google OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add redirect URI: `starter-react-native-cdpi://auth/google/callback`
6. Note down your Client ID and Client Secret

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` file with your values:

```env
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=starter-react-native-cdpi://auth/google/callback

# Your Auth Service Configuration
PORT=3001
AUTH_SERVICE_URL=http://localhost:3001

# Existing Ticketing API Configuration
TICKETING_API_BASE_URL=https://ticketing.development.atelier.ovh/api/mobile
TICKETING_REGISTER_ENDPOINT=/auth/register

# Security
JWT_SECRET=your_jwt_secret_here_for_state_tokens
```

### 4. Start the Service

```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

The service will run on `http://localhost:3001`

## 📡 API Endpoints

### GET `/auth/google/url`
Generates Google OAuth URL for mobile app.

**Response:**
```json
{
  "auth_url": "https://accounts.google.com/o/oauth2/auth?...",
  "state": "secure_random_token"
}
```

### POST `/auth/google/complete`
Completes Google authentication and registers user.

**Request:**
```json
{
  "authCode": "4/0AXXXXxxxxxxx",
  "state": "secure_random_token"
}
```

**Success Response:**
```json
{
  "success": true,
  "user": {
    "id": 123,
    "email": "user@gmail.com",
    "name": "John Doe",
    "username": "john"
  },
  "access_token": "jwt_token_here",
  "refresh_token": "refresh_token_here",
  "message": "User registered and logged in successfully via Google"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error type",
  "message": "Human readable error message"
}
```

### GET `/health`
Health check endpoint.

## 🔧 Update Mobile App

Update your mobile app's API base URL to point to your service:

```javascript
// In services/api.ts
const baseURL = 'http://localhost:3001'; // Your auth service URL
```

## 🚀 Deployment Options

### Option 1: Local Development
Run on your local machine (good for testing)

### Option 2: Vercel (Free)
1. Create `vercel.json` configuration
2. Deploy with `vercel --prod`

### Option 3: Railway/Render (Free tier)
1. Connect your GitHub repository
2. Set environment variables
3. Deploy automatically

### Option 4: DigitalOcean/AWS (Paid)
For production use with custom domain

## 🔐 Security Features

- CSRF protection with state tokens
- State token expiration (10 minutes)
- Input validation and sanitization
- Secure password generation for Google users
- Error handling without sensitive data exposure

## 🧪 Testing

### Test Health Check
```bash
curl http://localhost:3001/health
```

### Test Auth URL Generation
```bash
curl http://localhost:3001/auth/google/url
```

### Test Complete Authentication
```bash
curl -X POST http://localhost:3001/auth/google/complete \
  -H "Content-Type: application/json" \
  -d '{"authCode":"test_code","state":"test_state"}'
```

## 🐛 Troubleshooting

### Common Issues:

1. **"Invalid redirect URI"**
   - Make sure redirect URI is added to Google Cloud Console
   - Check spelling: `starter-react-native-cdpi://auth/google/callback`

2. **"Invalid state token"**
   - State tokens expire after 10 minutes
   - Each state token can only be used once

3. **"Registration failed"**
   - Check ticketing API endpoint URL
   - Verify user data format matches ticketing API requirements

4. **"CORS errors"**
   - Service includes CORS headers for all origins
   - If issues persist, check network connectivity

## 📝 Logs

The service provides detailed logging:
- 🔵 Info messages (normal operations)
- ✅ Success messages (completed operations)
- ⚠️ Warning messages (handled errors)
- ❌ Error messages (failures)

## 🔄 Flow Diagram

```
1. Mobile app requests Google auth URL
   → GET /auth/google/url
   ← Returns Google OAuth URL + state token

2. User completes Google authentication
   → Mobile app receives authorization code

3. Mobile app sends code to complete authentication
   → POST /auth/google/complete {authCode, state}
   
4. Service exchanges code for Google access token
   → Calls Google OAuth API
   
5. Service fetches user info from Google
   → Calls Google userinfo API
   
6. Service registers user with ticketing API
   → POST to existing ticketing registration endpoint
   
7. Service returns ticketing API tokens to mobile app
   ← Mobile app receives access tokens and user data
```

## 📞 Support

If you encounter issues:
1. Check the logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test each endpoint individually
4. Check Google Cloud Console configuration 

## 🔐 Google Cloud Console Setup

### Create OAuth 2.0 Client ID
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services → Credentials**
3. Click **+ CREATE CREDENTIALS → OAuth 2.0 Client ID**
4. Choose **Web Application**
5. Name: "Ticketing Mobile App"
6. Add **Authorized redirect URIs**:
   - `http://localhost:3001/auth/google/success`
   (Same URI for both development and production)
7. Save and copy your **Client ID** and **Client Secret** 