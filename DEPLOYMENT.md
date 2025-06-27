# 🚀 Free Deployment Options for Google Auth Service

## Option 1: Render.com (Recommended)

### Step 1: Prepare Repository
1. Push your `google-auth-service` folder to a GitHub repository
2. Make sure `render.yaml` is in the root of your auth service

### Step 2: Deploy on Render
1. Go to [render.com](https://render.com) and sign up
2. Click "New Web Service"
3. Connect your GitHub repository
4. Select the `google-auth-service` folder
5. Render will auto-detect the `render.yaml` configuration

### Step 3: Set Environment Variables
In Render dashboard, add these environment variables:
```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://your-service.onrender.com/auth/google/callback
MAIN_API_BASE_URL=https://ticketing.development.atelier.ovh/api/mobile
JWT_SECRET=your_jwt_secret
ADMIN_EMAIL=admin-cdpi@atelier.ovh
ADMIN_PASSWORD=AdminCDPI123
PORT=3001
```

### Step 4: Update Mobile App
Your service URL will be: `https://your-service-name.onrender.com`

---

## Option 2: Railway.app

### Step 1: Deploy
1. Go to [railway.app](https://railway.app)
2. Click "Deploy from GitHub repo"
3. Select your repository and `google-auth-service` folder
4. Railway will auto-deploy using `railway.json`

### Step 2: Set Environment Variables
Same variables as Render, but your URL will be: `https://your-service.up.railway.app`

---

## Option 3: Vercel (Serverless)

### Step 1: Install Vercel CLI
```bash
npm i -g vercel
```

### Step 2: Deploy
```bash
cd google-auth-service
vercel --prod
```

### Step 3: Set Environment Variables
```bash
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
# ... add all other variables
```

Your service URL will be: `https://your-service.vercel.app`

---

## Update Mobile App Configuration

After deploying, update your mobile app's API service:

```javascript
// In services/api.ts
const GOOGLE_AUTH_SERVICE_URL = 'https://your-deployed-service.com';
```

## Benefits vs Ngrok

✅ **Permanent URL** - No need to update domains constantly
✅ **SSL by default** - Required for Google OAuth
✅ **Free tier** - No cost for basic usage
✅ **Auto-deployment** - Push code, auto-deploy
✅ **Environment variables** - Secure config management
✅ **Custom domains** - Professional appearance

## Recommended: Render.com

- **Free tier**: 750 hours/month
- **Auto-sleep**: After 15 minutes (wakes up in ~30 seconds)
- **Custom domains**: Free
- **SSL**: Automatic
- **GitHub integration**: Seamless 