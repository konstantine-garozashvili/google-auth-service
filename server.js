const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory state storage (in production, use Redis or database)
const stateStore = new Map();

// Helper function to generate secure random state
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper function to validate state
function validateState(state) {
  if (stateStore.has(state)) {
    stateStore.delete(state); // Use state only once
    return true;
  }
  return false;
}

// ============================================
// Endpoint 1: Generate Google Auth URL
// ============================================
app.get('/auth/google/url', (req, res) => {
  try {
    console.log('🔵 Generating Google auth URL...');
    
    // Generate and store state for CSRF protection
    const state = generateState();
    stateStore.set(state, { timestamp: Date.now() });
    
    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of stateStore.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        stateStore.delete(key);
      }
    }
    
    // Choose redirect URI based on environment
    const redirectUri = process.env.NODE_ENV === 'development' 
      ? process.env.DEVELOPMENT_REDIRECT_URI 
      : process.env.PRODUCTION_REDIRECT_URI;
    
    console.log('🔵 Using redirect URI:', redirectUri);
    
    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      response_type: 'code',
      access_type: 'offline',
      state: state
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    
    console.log('✅ Google auth URL generated successfully');
    res.json({
      auth_url: authUrl,
      state: state
    });
    
  } catch (error) {
    console.error('❌ Error generating Google auth URL:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Google auth URL',
      message: error.message
    });
  }
});

// ============================================
// Endpoint 2: Complete Google Authentication
// ============================================
app.post('/auth/google/complete', async (req, res) => {
  try {
    const { authCode, state } = req.body;
    
    console.log('🔵 Processing Google auth completion...');
    console.log('🔵 Auth code:', authCode ? authCode.substring(0, 10) + '...' : 'missing');
    console.log('🔵 State:', state);
    
    // Validate input
    if (!authCode || !state) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        message: 'authCode and state are required'
      });
    }
    
    // Validate state token
    if (!validateState(state)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid state token',
        message: 'State token is invalid or expired'
      });
    }
    
    // Step 1: Exchange authorization code for Google access token
    console.log('🔄 Exchanging auth code for Google access token...');
    
    // Use the same redirect URI that was used for the auth URL
    const redirectUri = process.env.NODE_ENV === 'development' 
      ? process.env.DEVELOPMENT_REDIRECT_URI 
      : process.env.PRODUCTION_REDIRECT_URI;
    
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code: authCode,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });
    
    const { access_token } = tokenResponse.data;
    console.log('✅ Google access token received');
    
    // Step 2: Get user info from Google
    console.log('🔄 Fetching user info from Google...');
    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });
    
    const googleUser = userResponse.data;
    console.log('✅ Google user info retrieved:', googleUser.email);
    
    // Step 3: Prepare user data for ticketing API registration
    const userData = {
      name: googleUser.name,
      email: googleUser.email,
      username: googleUser.email.split('@')[0], // Use email prefix as username
      password: 'GoogleAuth_' + crypto.randomBytes(8).toString('hex'), // Generate random password
      google_id: googleUser.id,
      provider: 'google'
    };
    
    // Step 4: Register user with existing ticketing API
    console.log('🔄 Registering user with ticketing API...');
    try {
      const registrationResponse = await axios.post(
        `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_REGISTER_ENDPOINT}`,
        userData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );
      
      console.log('✅ User registered successfully with ticketing API');
      
      // Return success response with ticketing API data
      res.json({
        success: true,
        user: {
          id: registrationResponse.data.user?.id,
          email: googleUser.email,
          name: googleUser.name,
          username: userData.username
        },
        access_token: registrationResponse.data.access_token,
        refresh_token: registrationResponse.data.refresh_token,
        message: 'User registered and logged in successfully via Google'
      });
      
    } catch (registrationError) {
      console.log('⚠️ Registration failed, might be existing user');
      
      // If registration fails (user might already exist), try to login existing user with their Google email
      if (registrationError.response?.status === 409 || 
          registrationError.response?.data?.error?.includes('existe déjà') ||
          registrationError.response?.data?.message?.includes('already exists')) {
        
        console.log('🔄 User already exists, attempting to login existing user...');
        console.log('🔵 Trying to login user:', googleUser.email);
        
                console.log('🔄 User already exists - providing Google user info for auto-login...');
        console.log('🔵 User email:', googleUser.email);
        
        // For existing users, return success with Google user info and let the mobile app handle it
        // The mobile app should store the Google user data and show it in the UI
        return res.json({
          success: true,
          is_existing_user: true,
          user: {
            email: googleUser.email,
            name: googleUser.name,
            username: userData.username,
            provider: 'google',
            google_id: googleUser.id,
            verified_email: googleUser.verified_email,
            picture: googleUser.picture
          },
          message: 'Google user verified - existing account detected',
          instructions: 'Use Google user data for login display'
        });
      }
      
      // Other registration errors
      console.error('❌ Ticketing API registration error:', registrationError.response?.data || registrationError.message);
      return res.status(500).json({
        success: false,
        error: 'Registration failed',
        message: 'Failed to register user with ticketing system',
        details: registrationError.response?.data?.message || registrationError.message
      });
    }
    
  } catch (error) {
    console.error('❌ Google auth completion error:', error);
    
    if (error.response) {
      // Google API error
      return res.status(400).json({
        success: false,
        error: 'Google authentication failed',
        message: error.response.data.error_description || 'Invalid authorization code'
      });
    }
    
    // General server error
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'An unexpected error occurred during authentication'
    });
  }
});

// ============================================
// Development Success Page (for Expo Go)
// ============================================
app.get('/auth/google/success', (req, res) => {
  const { code, state } = req.query;
  
  if (code && state) {
    // Store the auth code temporarily (in production, use Redis)
    const sessionKey = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    stateStore.set(sessionKey, { code, state, timestamp: Date.now() });
    
    // Also store globally for mobile app pickup (simplified for development)
    global.latestAuthData = {
      code: code,
      state: state,
      timestamp: new Date().toISOString()
    };
    console.log('💾 Auth data stored for mobile app pickup');
    
    // Show success page with instructions
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google Authentication Success</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
          .code { background: #f0f0f0; padding: 10px; border-radius: 4px; font-family: monospace; margin: 20px 0; word-break: break-all; }
          .button { background: #4CAF50; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
          .instruction { margin: 20px 0; line-height: 1.5; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✅ Google Authentication Successful!</div>
          <p class="instruction">Your authentication was successful. Return to your mobile app and tap the button below to complete the login.</p>
          
          <div class="code">Session: ${sessionKey}</div>
          
          <button class="button" onclick="copySession()">Copy Session Code</button>
          
          <p class="instruction"><strong>Instructions:</strong><br>
          1. Copy the session code above<br>
          2. Return to your mobile app<br>
          3. The app will automatically detect your authentication</p>
        </div>
        
        <script>
          function copySession() {
            navigator.clipboard.writeText('${sessionKey}');
            alert('Session code copied! Return to your mobile app.');
          }
          
          // Auto-redirect after 3 seconds
          setTimeout(function() {
            window.close();
          }, 5000);
        </script>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Authentication Error</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; margin: 40px;">
        <h2 style="color: #f44336;">❌ Authentication Failed</h2>
        <p>No authorization code received. Please try again.</p>
      </body>
      </html>
    `);
  }
});

// ============================================
// Development: Check Authentication Status
// ============================================
app.get('/auth/check/:sessionKey', (req, res) => {
  const { sessionKey } = req.params;
  
  if (stateStore.has(sessionKey)) {
    const authData = stateStore.get(sessionKey);
    stateStore.delete(sessionKey); // Use once
    
    res.json({
      success: true,
      authCode: authData.code,
      state: authData.state
    });
  } else {
    res.status(404).json({
      success: false,
      message: 'Session not found or expired'
    });
  }
});

// ============================================
// Session Check Endpoint (for mobile app polling)
// ============================================
app.get('/auth/check-session', (req, res) => {
  console.log('📱 Mobile app checking for auth session...');
  
  // Check if we have any stored session data
  if (global.latestAuthData) {
    console.log('✅ Found auth session data for mobile app');
    const authData = global.latestAuthData;
    
    // Clear it after sending (single use)
    global.latestAuthData = null;
    
    res.json({
      authCode: authData.code,
      state: authData.state,
      timestamp: authData.timestamp
    });
  } else {
    console.log('❌ No auth session data available');
    res.json({
      authCode: null,
      state: null
    });
  }
});

// ============================================
// Health Check Endpoint
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Google Auth Service',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth_url: '/auth/google/url',
      complete_auth: '/auth/google/complete',
      check_session: '/auth/check-session'
    }
  });
});

// ============================================
// Error Handling Middleware
// ============================================
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  });
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Google Auth Service running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health (local) | http://10.10.150.255:${PORT}/health (mobile)`);
  console.log(`🔗 Auth URL endpoint: http://10.10.150.255:${PORT}/auth/google/url (mobile)`);
  console.log(`✅ Complete auth endpoint: http://10.10.150.255:${PORT}/auth/google/complete (mobile)`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Mobile app connects via: http://10.10.150.255:${PORT}`);
  console.log(`🌐 Google OAuth redirects to: http://localhost:${PORT}/auth/google/success`);
});

module.exports = app; 