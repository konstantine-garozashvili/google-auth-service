const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Google Auth Service v2.1 - Deployment: 2025-06-27-21:30 - WITH BYPASS LOGIC
console.log('🚀 Google Auth Service v2.4 starting with Enhanced Debug Logging and Alternative Password Patterns...');

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
    
    // Step 4: Hybrid Google + Ticketing API Integration
    console.log('🔄 Processing Google user with ticketing API integration...');
    
    // Generate a consistent password for this Google user based on their Google ID
    const userPassword = 'GoogleAuth_' + googleUser.id + '_' + googleUser.email.split('@')[0];
    const userData = {
      name: googleUser.name,
      email: googleUser.email,
      username: googleUser.email.split('@')[0], // Use email prefix as username
      password: userPassword,
      google_id: googleUser.id,
      provider: 'google'
    };
    
    console.log('🔵 Attempting ticketing API integration for Google user:', googleUser.email);
    
    try {
      // Try to register the user with ticketing API
      console.log('🔄 Registering new Google user with ticketing API...');
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
      
      console.log('✅ New Google user registered successfully with ticketing API');
      
      // Store this authentication session globally for the mobile app to retrieve
      global.latestAuthData = {
        success: true,
        user: {
          id: registrationResponse.data.user?.id,
          email: googleUser.email,
          name: googleUser.name,
          username: userData.username,
          picture: googleUser.picture,
          verified_email: googleUser.verified_email,
          google_id: googleUser.id,
          provider: 'google',
          admin: registrationResponse.data.user?.admin,
          admin_level: registrationResponse.data.user?.admin_level,
          company: registrationResponse.data.user?.company,
          has_api_access: true,
          google_only_mode: false,
          stored_password: userPassword // Store password for future use
        },
        access_token: registrationResponse.data.access_token,
        refresh_token: registrationResponse.data.refresh_token,
        message: 'New Google user registered with full ticketing API access',
        google_ticketing_mode: true,
        timestamp: Date.now()
      };
      
      // Return success response with full ticketing API access
      res.json({
        success: true,
        user: {
          id: registrationResponse.data.user?.id,
          email: googleUser.email,
          name: googleUser.name,
          username: userData.username,
          picture: googleUser.picture,
          verified_email: googleUser.verified_email,
          google_id: googleUser.id,
          provider: 'google',
          admin: registrationResponse.data.user?.admin,
          admin_level: registrationResponse.data.user?.admin_level,
          company: registrationResponse.data.user?.company
        },
        access_token: registrationResponse.data.access_token,
        refresh_token: registrationResponse.data.refresh_token,
        message: 'New Google user registered with full ticketing API access',
        google_ticketing_mode: true,
        timestamp: Date.now()
      });
      
    } catch (registrationError) {
      // User might already exist - try to login with the stored password
      if (registrationError.response?.status === 409 || 
          registrationError.response?.data?.error?.includes('existe déjà') ||
          registrationError.response?.data?.message?.includes('already exists')) {
        
        console.log('🔄 Google user already exists - attempting login with stored password...');
        
        try {
          // Try to login with the consistent password
          const loginResponse = await axios.post(
            `${process.env.TICKETING_API_BASE_URL}${process.env.TICKETING_LOGIN_ENDPOINT}`,
            {
              identity: googleUser.email,
              password: userPassword
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            }
          );
          
          console.log('✅ Existing Google user authenticated successfully with stored password!');
          
          // Store this authentication session globally for the mobile app to retrieve
          global.latestAuthData = {
            success: true,
            user: {
              id: loginResponse.data.user?.id,
              email: googleUser.email,
              name: googleUser.name,
              username: userData.username,
              picture: googleUser.picture,
              verified_email: googleUser.verified_email,
              google_id: googleUser.id,
              provider: 'google',
              admin: loginResponse.data.user?.admin,
              admin_level: loginResponse.data.user?.admin_level,
              company: loginResponse.data.user?.company,
              has_api_access: true,
              google_only_mode: false,
              stored_password: userPassword // Store password for future use
            },
            access_token: loginResponse.data.access_token,
            refresh_token: loginResponse.data.refresh_token,
            message: 'Existing Google user authenticated with stored credentials',
            google_ticketing_mode: true,
            timestamp: Date.now()
          };
          
          // Return success response with full ticketing API access
          res.json({
            success: true,
            user: {
              id: loginResponse.data.user?.id,
              email: googleUser.email,
              name: googleUser.name,
              username: userData.username,
              picture: googleUser.picture,
              verified_email: googleUser.verified_email,
              google_id: googleUser.id,
              provider: 'google',
              admin: loginResponse.data.user?.admin,
              admin_level: loginResponse.data.user?.admin_level,
              company: loginResponse.data.user?.company
            },
            access_token: loginResponse.data.access_token,
            refresh_token: loginResponse.data.refresh_token,
            message: 'Existing Google user authenticated with stored credentials',
            google_ticketing_mode: true,
            timestamp: Date.now()
          });
          
        } catch (loginError) {
          console.log('❌ Login with stored password failed - password might have changed');
          console.log('🔄 Attempting to register with unique credentials...');
          
          // Try to register with a unique username to avoid conflicts
          const uniqueUsername = userData.username + '_' + Date.now().toString().substring(-4);
          const uniquePassword = 'GoogleAuth_' + crypto.randomBytes(12).toString('hex');
          
          try {
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
            
            // Store this authentication session globally for the mobile app to retrieve
            global.latestAuthData = {
              success: true,
              user: {
                id: retryRegistrationResponse.data.user?.id,
                email: googleUser.email,
                name: googleUser.name,
                username: uniqueUsername,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email,
                google_id: googleUser.id,
                provider: 'google',
                admin: retryRegistrationResponse.data.user?.admin,
                admin_level: retryRegistrationResponse.data.user?.admin_level,
                company: retryRegistrationResponse.data.user?.company,
                has_api_access: true,
                google_only_mode: false,
                stored_password: uniquePassword // Store new password for future use
              },
              access_token: retryRegistrationResponse.data.access_token,
              refresh_token: retryRegistrationResponse.data.refresh_token,
              message: 'Google user registered with unique credentials',
              google_ticketing_mode: true,
              timestamp: Date.now()
            };
            
            res.json({
              success: true,
              user: {
                id: retryRegistrationResponse.data.user?.id,
                email: googleUser.email,
                name: googleUser.name,
                username: uniqueUsername,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email,
                google_id: googleUser.id,
                provider: 'google'
              },
              access_token: retryRegistrationResponse.data.access_token,
              refresh_token: retryRegistrationResponse.data.refresh_token,
              message: 'Google user registered with unique credentials',
              google_ticketing_mode: true,
              timestamp: Date.now()
            });
            
          } catch (retryError) {
            console.error('❌ All ticketing API attempts failed for Google user');
            throw new Error('Failed to integrate Google user with ticketing system');
          }
        }
      } else {
        console.error('❌ Ticketing API registration error:', registrationError.response?.data || registrationError.message);
        throw registrationError;
      }
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
      
      // Check if this is raw OAuth data (code + state) or processed user data
      if (authData.code && authData.state && !authData.user) {
        console.log('🔄 Found raw OAuth data - processing with ticketing API...');
        
        // Clear the raw data to prevent reuse
        global.latestAuthData = null;
        
        try {
          // Process the OAuth code with Google to get user info
          const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: authData.code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.NODE_ENV === 'development' 
              ? process.env.DEVELOPMENT_REDIRECT_URI 
              : process.env.PRODUCTION_REDIRECT_URI
          });

          const { access_token } = tokenResponse.data;

          // Get user info from Google
          const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
          });

          const googleUser = userResponse.data;
          console.log('✅ Google user info retrieved:', googleUser.email);

          // Process with ticketing API (hybrid approach)
          const userData = {
            name: googleUser.name,
            email: googleUser.email,
            username: googleUser.email.split('@')[0],
            password: `GoogleAuth_${googleUser.id}_${googleUser.email.split('@')[0]}`
          };

          console.log('🔄 Attempting to register Google user with ticketing API...');
          console.log('🔍 DEBUG: Registration data being sent:', JSON.stringify(userData, null, 2));
          console.log('🔍 DEBUG: Registration URL:', `${process.env.TICKETING_API_BASE_URL}/auth/register`);

          try {
            // Try to register the user
            const registrationResponse = await axios.post(
              `${process.env.TICKETING_API_BASE_URL}/auth/register`,
              userData,
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                }
              }
            );

            console.log('✅ Google user registered successfully!');
            console.log('🔍 DEBUG: Registration response:', JSON.stringify(registrationResponse.data, null, 2));

            // Return the processed authentication data
            const processedAuthData = {
              success: true,
              user: {
                id: registrationResponse.data.user?.id,
                email: googleUser.email,
                name: googleUser.name,
                username: userData.username,
                picture: googleUser.picture,
                verified_email: googleUser.verified_email,
                google_id: googleUser.id,
                provider: 'google',
                admin: registrationResponse.data.user?.admin,
                admin_level: registrationResponse.data.user?.admin_level,
                company: registrationResponse.data.user?.company
              },
              access_token: registrationResponse.data.access_token,
              refresh_token: registrationResponse.data.refresh_token,
              message: 'Google user registered with ticketing API',
              google_ticketing_mode: true,
              timestamp: Date.now()
            };

            console.log('🎉 Returning processed Google authentication data to mobile app');
            res.json(processedAuthData);

          } catch (registrationError) {
            console.log('🔍 DEBUG: Registration error status:', registrationError.response?.status);
            console.log('🔍 DEBUG: Registration error message:', registrationError.response?.data?.message || registrationError.message);
            
            if (registrationError.response?.status === 409) {
              // User already exists, try to login
              console.log('👤 User already exists - attempting login with stored password...');

                             try {
                 console.log('🔍 DEBUG: Attempting login with email:', userData.email);
                 console.log('🔍 DEBUG: Generated password pattern:', userData.password);
                 console.log('🔍 DEBUG: Login data being sent:', JSON.stringify({
                   email: userData.email,
                   password: userData.password
                 }, null, 2));
                 console.log('🔍 DEBUG: Login URL:', `${process.env.TICKETING_API_BASE_URL}/auth/login`);
                 
                 const loginResponse = await axios.post(
                   `${process.env.TICKETING_API_BASE_URL}/auth/login`,
                   {
                     identity: userData.email,
                     password: userData.password
                   },
                   {
                     headers: {
                       'Content-Type': 'application/json',
                       'Accept': 'application/json'
                     }
                   }
                 );

                 console.log('✅ Existing Google user authenticated successfully!');

                // Return the processed authentication data
                const processedAuthData = {
                  success: true,
                  user: {
                    id: loginResponse.data.user?.id,
                    email: googleUser.email,
                    name: googleUser.name,
                    username: userData.username,
                    picture: googleUser.picture,
                    verified_email: googleUser.verified_email,
                    google_id: googleUser.id,
                    provider: 'google',
                    admin: loginResponse.data.user?.admin,
                    admin_level: loginResponse.data.user?.admin_level,
                    company: loginResponse.data.user?.company
                  },
                  access_token: loginResponse.data.access_token,
                  refresh_token: loginResponse.data.refresh_token,
                  message: 'Existing Google user authenticated with stored credentials',
                  google_ticketing_mode: true,
                  timestamp: Date.now()
                };

                console.log('🎉 Returning existing user authentication data to mobile app');
                res.json(processedAuthData);

                                            } catch (loginError) {
                 console.log('❌ Login with stored password failed - trying alternative password patterns...');
                 console.log('🔍 DEBUG: Login error status:', loginError.response?.status);
                 console.log('🔍 DEBUG: Login error message:', loginError.response?.data?.message || loginError.message);
                 
                 // Try alternative password patterns for existing users
                 const alternativePasswords = [
                   `GoogleAuth_${googleUser.id}`, // Without email prefix
                   `GoogleAuth_${googleUser.email.split('@')[0]}_${googleUser.id}`, // Reversed order
                   `Google_${googleUser.id}_${googleUser.email.split('@')[0]}`, // Different prefix
                   `GoogleAuth_${googleUser.id}_${googleUser.email.split('@')[0].toLowerCase()}`, // Lowercase
                   `GoogleAuth_${googleUser.id}_${googleUser.email.split('@')[0].replace(/\./g, '')}` // Remove dots
                 ];
                 
                 let alternativeLoginSuccess = false;
                 
                 for (let i = 0; i < alternativePasswords.length; i++) {
                   const altPassword = alternativePasswords[i];
                   console.log(`🔄 Trying alternative password pattern ${i + 1}/${alternativePasswords.length}: ${altPassword}`);
                   
                   try {
                     const altLoginResponse = await axios.post(
                       `${process.env.TICKETING_API_BASE_URL}/auth/login`,
                       {
                         identity: userData.email,
                         password: altPassword
                       },
                       {
                         headers: {
                           'Content-Type': 'application/json',
                           'Accept': 'application/json'
                         }
                       }
                     );
                     
                     console.log(`✅ Alternative password pattern ${i + 1} worked! User authenticated successfully.`);
                     
                     // Return the processed authentication data
                     const processedAuthData = {
                       success: true,
                       user: {
                         id: altLoginResponse.data.user?.id,
                         email: googleUser.email,
                         name: googleUser.name,
                         username: userData.username,
                         picture: googleUser.picture,
                         verified_email: googleUser.verified_email,
                         google_id: googleUser.id,
                         provider: 'google',
                         admin: altLoginResponse.data.user?.admin,
                         admin_level: altLoginResponse.data.user?.admin_level,
                         company: altLoginResponse.data.user?.company
                       },
                       access_token: altLoginResponse.data.access_token,
                       refresh_token: altLoginResponse.data.refresh_token,
                       message: `Existing Google user authenticated with alternative password pattern ${i + 1}`,
                       google_ticketing_mode: true,
                       timestamp: Date.now()
                     };

                     console.log('🎉 Returning alternative authentication data to mobile app');
                     res.json(processedAuthData);
                     alternativeLoginSuccess = true;
                     break;
                     
                   } catch (altError) {
                     console.log(`❌ Alternative password pattern ${i + 1} failed:`, altError.response?.data?.message || altError.message);
                     continue;
                   }
                 }
                 
                 if (!alternativeLoginSuccess) {
                   console.log('❌ All password patterns failed - falling back to limited mode');
                   
                   // Return limited mode data
                   const limitedAuthData = {
                     success: true,
                     user: {
                       email: googleUser.email,
                       name: googleUser.name,
                       username: userData.username,
                       picture: googleUser.picture,
                       verified_email: googleUser.verified_email,
                       google_id: googleUser.id,
                       provider: 'google'
                     },
                     message: 'Google user authenticated in limited mode - unable to link with existing account',
                     google_only_mode: true,
                     timestamp: Date.now()
                   };

                   console.log('⚠️ Returning limited mode authentication data to mobile app');
                   res.json(limitedAuthData);
                 }
               }
            } else {
              throw registrationError;
            }
          }

        } catch (error) {
          console.error('❌ Error processing OAuth data:', error);
          res.status(500).json({
            success: false,
            error: 'Failed to process authentication',
            message: error.message
          });
        }

      } else if (authData.user) {
        // Already processed user data - return it
        console.log('✅ Found processed user data for mobile app');
        
        // Clear it after getting (single use)
        global.latestAuthData = null;
        
        console.log('🎉 Returning processed authentication data to mobile app');
        res.json(authData);

      } else {
        console.log('❌ Invalid authentication session data');
        res.json({
          success: false,
          authCode: null,
          state: null,
          message: 'Invalid authentication session data'
        });
      }
      
    } else {
      console.log('❌ No authentication session found');
      res.json({
        success: false,
        authCode: null,
        state: null,
        message: 'No authentication session found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check session',
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