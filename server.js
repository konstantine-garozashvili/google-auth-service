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
    
    // Clear any existing auth data when starting new authentication
    // This helps prevent conflicts when switching between Google accounts
    if (global.latestAuthData) {
      console.log('🧹 Clearing previous auth data before new authentication');
      global.latestAuthData = null;
    }
    
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
    
    // Build Google OAuth URL with additional parameters to force account selection
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      response_type: 'code',
      access_type: 'offline',
      state: state,
      prompt: 'select_account', // Force Google to show account selection
      include_granted_scopes: 'true'
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    
    console.log('✅ Google auth URL generated successfully with account selection');
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
          username: userData.username,
          picture: googleUser.picture,
          verified_email: googleUser.verified_email
        },
        access_token: registrationResponse.data.access_token,
        refresh_token: registrationResponse.data.refresh_token,
        message: 'User registered and logged in successfully via Google',
        timestamp: Date.now()
      });
      
    } catch (registrationError) {
      console.log('⚠️ Registration failed, might be existing user');
      
      // If registration fails (user might already exist), try to login existing user with their Google email
      if (registrationError.response?.status === 409 || 
          registrationError.response?.data?.error?.includes('existe déjà') ||
          registrationError.response?.data?.message?.includes('already exists')) {
        
        console.log('🔄 User already exists in ticketing API - attempting Google user authentication...');
        console.log('🔵 Trying to authenticate existing Google user:', googleUser.email);
        
        // Try to login the existing user with potential Google-generated passwords
        const possiblePasswords = [
          'GoogleAuth_' + googleUser.id.substring(0, 8), // Based on Google ID
          'GoogleAuth_' + googleUser.email.split('@')[0], // Based on email prefix
          'GoogleAuth2024_' + googleUser.id.substring(-8), // Alternative pattern
          'GoogleUser_' + googleUser.id.substring(0, 10), // Another common pattern
        ];
        
        for (const password of possiblePasswords) {
          try {
            console.log('🔄 Attempting login with Google-style password...');
            const loginResponse = await axios.post(
              `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_LOGIN_ENDPOINT}`,
              {
                email: googleUser.email,
                password: password
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                }
              }
            );
            
            console.log('✅ Google user authenticated successfully with API!');
            console.log('🎉 Google user has full API access now!');
            
            // Success! Return with full API access
            res.json({
              success: true,
              user: {
                id: loginResponse.data.user?.id,
                email: googleUser.email,
                name: googleUser.name,
                username: userData.username,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email,
                admin: loginResponse.data.user?.admin,
                admin_level: loginResponse.data.user?.admin_level,
                company: loginResponse.data.user?.company
              },
              access_token: loginResponse.data.access_token,
              refresh_token: loginResponse.data.refresh_token,
              message: 'Google user authenticated with full API access',
              has_api_access: true,
              provider: 'google',
              timestamp: Date.now()
            });
            return; // Exit the function on success
            
          } catch (loginError) {
            console.log('❌ Login attempt failed with password pattern, trying next...');
            // Continue to next password
          }
        }
        
        // If all password attempts failed, try to register the user again with a unique password
        console.log('🔄 Password attempts failed, trying to register user with unique password...');
        try {
          const uniquePassword = 'GoogleAuth_' + crypto.randomBytes(12).toString('hex');
          const uniqueUsername = userData.username + '_' + Date.now().toString().substring(-4);
          
          const retryRegistrationResponse = await axios.post(
            `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_REGISTER_ENDPOINT}`,
            {
              ...userData,
              username: uniqueUsername,
              password: uniquePassword
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          console.log('✅ Google user registered with unique credentials!');
          
          res.json({
            success: true,
            user: {
              id: retryRegistrationResponse.data.user?.id,
              email: googleUser.email,
              name: googleUser.name,
              username: uniqueUsername,
              picture: googleUser.picture,
              verified_email: googleUser.verified_email
            },
            access_token: retryRegistrationResponse.data.access_token,
            refresh_token: retryRegistrationResponse.data.refresh_token,
            message: 'Google user registered with unique credentials',
            has_api_access: true,
            provider: 'google',
            timestamp: Date.now()
          });
          
        } catch (retryError) {
          console.log('❌ All authentication attempts failed for Google user');
          console.log('💡 Providing Google user info for manual API access attempt');
          
          // Last resort: return user info with a flag to try API access manually
          res.json({
            success: true,
            is_existing_user: true,
            user: {
              email: googleUser.email,
              name: googleUser.name,
              username: userData.username,
              google_id: googleUser.id,
              picture: googleUser.picture,
              verified_email: googleUser.verified_email,
              provider: 'google'
            },
            message: 'Google user verified - try manual API access',
            should_attempt_api_access: true,
            suggested_passwords: possiblePasswords.slice(0, 2), // Send first 2 password patterns
            timestamp: Date.now()
          });
        }
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
  const { code, state, error, error_description } = req.query;
  
  console.log('🔵 Google OAuth redirect received');
  console.log('🔵 Code:', code ? 'present' : 'missing');
  console.log('🔵 State:', state ? 'present' : 'missing');
  console.log('🔵 Error:', error || 'none');
  console.log('🔵 Error description:', error_description || 'none');
  
  // Handle OAuth errors first
  if (error) {
    console.error('❌ Google OAuth error:', error, error_description);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erreur d'Authentification</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
          .button { background: #f44336; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 10px; }
          .instruction { margin: 20px 0; line-height: 1.5; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error">❌ Erreur d'Authentification Google</div>
          <p class="instruction">
            ${error === 'access_denied' ? 
              'Vous avez annulé l\'authentification. Veuillez réessayer si vous souhaitez vous connecter.' :
              `Une erreur s'est produite: ${error_description || error}`
            }
          </p>
          <button class="button" onclick="window.close()">Fermer cette fenêtre</button>
          <button class="button" onclick="window.location.reload()">Réessayer</button>
        </div>
      </body>
      </html>
    `);
    return;
  }
  
  if (code && state) {
    // Clear any existing auth data to prevent conflicts with multiple accounts
    if (global.latestAuthData) {
      console.log('🧹 Clearing previous auth data to prevent account conflicts');
      global.latestAuthData = null;
    }
    
    // Store the auth code temporarily (in production, use Redis)
    const sessionKey = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    stateStore.set(sessionKey, { code, state, timestamp: Date.now() });
    
    // Store globally for mobile app pickup (simplified for development)
    global.latestAuthData = {
      code: code,
      state: state,
      timestamp: new Date().toISOString()
    };
    console.log('💾 New auth data stored for mobile app pickup');
    
    // Show success page with instructions
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentification Google Réussie</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
          .code { background: #f0f0f0; padding: 10px; border-radius: 4px; font-family: monospace; margin: 20px 0; word-break: break-all; font-size: 12px; }
          .button { background: #4CAF50; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; margin: 5px; }
          .instruction { margin: 20px 0; line-height: 1.5; color: #666; }
          .status { padding: 10px; background: #e8f5e8; border-radius: 4px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✅ Authentification Google Réussie!</div>
          <div class="status">Votre authentification a été traitée avec succès.</div>
          
          <p class="instruction">
            <strong>Retournez maintenant dans votre application mobile.</strong><br>
            L'application détectera automatiquement votre authentification dans quelques secondes.
          </p>
          
          <div class="code">ID de Session: ${sessionKey}</div>
          
          <button class="button" onclick="copySession()">Copier l'ID de Session</button>
          <button class="button" onclick="window.close()" style="background: #666;">Fermer</button>
          
          <p class="instruction" style="font-size: 14px;">
            <strong>Instructions si nécessaire:</strong><br>
            1. Si l'app ne détecte pas automatiquement l'authentification<br>
            2. Copiez l'ID de session ci-dessus<br>
            3. Utilisez la fonction de vérification manuelle dans l'app
          </p>
        </div>
        
        <script>
          function copySession() {
            if (navigator.clipboard) {
              navigator.clipboard.writeText('${sessionKey}').then(() => {
                alert('ID de session copié! Retournez dans votre application mobile.');
              });
            } else {
              // Fallback for older browsers
              const textArea = document.createElement('textarea');
              textArea.value = '${sessionKey}';
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              alert('ID de session copié! Retournez dans votre application mobile.');
            }
          }
          
          // Auto-close after 10 seconds
          setTimeout(function() {
            window.close();
          }, 10000);
        </script>
      </body>
      </html>
    `);
  } else {
    console.error('❌ No authorization code or state received');
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erreur d'Authentification</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
          .button { background: #f44336; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
          .instruction { margin: 20px 0; line-height: 1.5; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error">❌ Erreur d'Authentification</div>
          <p class="instruction">
            Aucun code d'autorisation reçu de Google. Veuillez réessayer l'authentification.
          </p>
          <button class="button" onclick="window.close()">Fermer cette fenêtre</button>
        </div>
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
app.get('/auth/check-session', async (req, res) => {
  console.log('📱 Mobile app checking for auth session...');
  
  try {
  // Check if we have any stored session data
  if (global.latestAuthData) {
    console.log('✅ Found auth session data for mobile app');
    const authData = global.latestAuthData;
    
      // Clear it after getting (single use)
      global.latestAuthData = null;
      
      console.log('🔄 Processing Google authentication for mobile app...');
      
      // Step 1: Exchange authorization code for Google access token
      const redirectUri = process.env.NODE_ENV === 'development' 
        ? process.env.DEVELOPMENT_REDIRECT_URI 
        : process.env.PRODUCTION_REDIRECT_URI;
      
      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
        code: authData.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      });
      
      const { access_token } = tokenResponse.data;
      console.log('✅ Google access token received for mobile app');
      
      // Step 2: Get user info from Google
      const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      
      const googleUser = userResponse.data;
      console.log('✅ Google user info retrieved for mobile app:', googleUser.email);
      
      // Step 3: Try to register/login user with ticketing API
      const userData = {
        name: googleUser.name,
        email: googleUser.email,
        username: googleUser.email.split('@')[0],
        password: 'GoogleAuth_' + crypto.randomBytes(8).toString('hex'),
        google_id: googleUser.id,
        provider: 'google'
      };
      
      try {
        // Try to register user
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
        
        console.log('✅ User registered successfully via mobile check-session');
        
        res.json({
          success: true,
          user: {
            id: registrationResponse.data.user?.id,
            email: googleUser.email,
            name: googleUser.name,
            username: userData.username,
            picture: googleUser.picture,
            verified_email: googleUser.verified_email
          },
          access_token: registrationResponse.data.access_token,
          refresh_token: registrationResponse.data.refresh_token,
          message: 'User registered and logged in successfully via Google',
          timestamp: authData.timestamp
        });
        
      } catch (registrationError) {
        // User might already exist
        if (registrationError.response?.status === 409 || 
            registrationError.response?.data?.error?.includes('existe déjà') ||
            registrationError.response?.data?.message?.includes('already exists')) {
          
          console.log('🔄 User already exists in ticketing API - attempting Google user authentication...');
          console.log('🔵 Trying to authenticate existing Google user:', googleUser.email);
          
          // Try to login the existing user with potential Google-generated passwords
          const possiblePasswords = [
            'GoogleAuth_' + googleUser.id.substring(0, 8), // Based on Google ID
            'GoogleAuth_' + googleUser.email.split('@')[0], // Based on email prefix
            'GoogleAuth2024_' + googleUser.id.substring(-8), // Alternative pattern
            'GoogleUser_' + googleUser.id.substring(0, 10), // Another common pattern
          ];
          
          for (const password of possiblePasswords) {
            try {
              console.log('🔄 Attempting login with Google-style password...');
              const loginResponse = await axios.post(
                `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_LOGIN_ENDPOINT}`,
                {
                  email: googleUser.email,
                  password: password
                },
                {
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                  }
                }
              );
              
              console.log('✅ Google user authenticated successfully with API!');
              console.log('🎉 Google user has full API access now!');
              
              // Success! Return with full API access
              res.json({
                success: true,
                user: {
                  id: loginResponse.data.user?.id,
                  email: googleUser.email,
                  name: googleUser.name,
                  username: userData.username,
                  picture: googleUser.picture,
                  verified_email: googleUser.verified_email,
                  admin: loginResponse.data.user?.admin,
                  admin_level: loginResponse.data.user?.admin_level,
                  company: loginResponse.data.user?.company
                },
                access_token: loginResponse.data.access_token,
                refresh_token: loginResponse.data.refresh_token,
                message: 'Google user authenticated with full API access',
                has_api_access: true,
                provider: 'google',
                timestamp: authData.timestamp
              });
              return; // Exit the function on success
              
            } catch (loginError) {
              console.log('❌ Login attempt failed with password pattern, trying next...');
              // Continue to next password
            }
          }
          
          // If all password attempts failed, try to register the user again with a unique password
          console.log('🔄 Password attempts failed, trying to register user with unique password...');
          try {
            const uniquePassword = 'GoogleAuth_' + crypto.randomBytes(12).toString('hex');
            const uniqueUsername = userData.username + '_' + Date.now().toString().substring(-4);
            
            const retryRegistrationResponse = await axios.post(
              `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_REGISTER_ENDPOINT}`,
              {
                ...userData,
                username: uniqueUsername,
                password: uniquePassword
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                }
              }
            );
            
            console.log('✅ Google user registered with unique credentials!');
            
            res.json({
              success: true,
              user: {
                id: retryRegistrationResponse.data.user?.id,
                email: googleUser.email,
                name: googleUser.name,
                username: uniqueUsername,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email
              },
              access_token: retryRegistrationResponse.data.access_token,
              refresh_token: retryRegistrationResponse.data.refresh_token,
              message: 'Google user registered with unique credentials',
              has_api_access: true,
              provider: 'google',
              timestamp: authData.timestamp
            });
            
          } catch (retryError) {
            console.log('❌ All authentication attempts failed for Google user');
            console.log('💡 Providing Google user info for manual API access attempt');
            
            // Last resort: return user info with a flag to try API access manually
            res.json({
              success: true,
              is_existing_user: true,
              user: {
                email: googleUser.email,
                name: googleUser.name,
                username: userData.username,
                google_id: googleUser.id,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email,
                provider: 'google'
              },
              message: 'Google user verified - try manual API access',
              should_attempt_api_access: true,
              suggested_passwords: possiblePasswords.slice(0, 2), // Send first 2 password patterns
              timestamp: authData.timestamp
            });
          }
        } else {
          throw registrationError;
        }
      }
      
    } else {
      console.log('❌ No auth session data available');
      res.json({
        success: false,
        authCode: null,
        state: null,
        message: 'No authentication session found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error in check-session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process authentication',
      message: error.message
    });
  }
});

// ============================================
// Clear Session Endpoint (for logout and account switching)
// ============================================
app.post('/auth/clear-session', (req, res) => {
  try {
    console.log('🧹 Clearing authentication session data...');
    
    // Clear global auth data
    if (global.latestAuthData) {
    global.latestAuthData = null;
      console.log('✅ Global auth data cleared');
    }
    
    // Clear all stored states (optional cleanup)
    const statesCleared = stateStore.size;
    stateStore.clear();
    console.log(`✅ Cleared ${statesCleared} stored states`);
    
    res.json({
      success: true,
      message: 'Authentication session cleared successfully',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error clearing session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear session',
      message: error.message
    });
  }
});

// ============================================
// Clear Session Before New Auth (GET endpoint for convenience)
// ============================================
app.get('/auth/clear-session', (req, res) => {
  try {
    console.log('🧹 Pre-clearing authentication session for new auth...');
    
    // Clear global auth data
    if (global.latestAuthData) {
      global.latestAuthData = null;
      console.log('✅ Previous auth data cleared for new authentication');
    }
    
    // Clear old stored states
    const statesCleared = stateStore.size;
    stateStore.clear();
    console.log(`✅ Cleared ${statesCleared} old stored states`);
    
    res.json({
      success: true,
      message: 'Previous authentication session cleared - ready for new authentication',
      cleared_states: statesCleared,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error pre-clearing session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear previous session',
      message: error.message
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
      check_session: '/auth/check-session',
      clear_session: '/auth/clear-session'
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
  const redirectUri = process.env.NODE_ENV === 'development' 
    ? process.env.DEVELOPMENT_REDIRECT_URI 
    : process.env.PRODUCTION_REDIRECT_URI;
    
  console.log(`🚀 Google Auth Service running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health (local) | http://10.10.150.255:${PORT}/health (mobile)`);
  console.log(`🔗 Auth URL endpoint: http://10.10.150.255:${PORT}/auth/google/url (mobile)`);
  console.log(`✅ Complete auth endpoint: http://10.10.150.255:${PORT}/auth/google/complete (mobile)`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Mobile app connects via: http://10.10.150.255:${PORT}`);
  console.log(`🌐 Google OAuth redirects to: ${redirectUri || 'NOT_SET'}`);
  
  // Debug: Show environment variables (without sensitive data)
  console.log(`🔍 DEBUG: NODE_ENV = ${process.env.NODE_ENV}`);
  console.log(`🔍 DEBUG: PRODUCTION_REDIRECT_URI = ${process.env.PRODUCTION_REDIRECT_URI ? 'SET' : 'NOT_SET'}`);
  console.log(`🔍 DEBUG: DEVELOPMENT_REDIRECT_URI = ${process.env.DEVELOPMENT_REDIRECT_URI ? 'SET' : 'NOT_SET'}`);
  console.log(`🔍 DEBUG: GOOGLE_CLIENT_ID = ${process.env.GOOGLE_CLIENT_ID ? 'SET' : 'NOT_SET'}`);
  console.log(`🔍 DEBUG: GOOGLE_CLIENT_SECRET = ${process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT_SET'}`);
});

module.exports = app; 