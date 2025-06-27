# 🔄 Ngrok Domain Update Workflow

## 📋 **Quick Steps When Ngrok Domain Changes**

### 1. **Start ngrok**
```bash
ngrok http 3001
```
Copy the new https URL (like `https://abc123.ngrok-free.app`)

### 2. **Update All Configuration Files Automatically**
```bash
cd google-auth-service
node update-ngrok-domain.js https://your-new-domain.ngrok-free.app
```

### 3. **Update Google Cloud Console**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Edit your OAuth client: `460554137899-2m5ktibb1dam0eknqhcb06a8qeeaku4k.apps.googleusercontent.com`
3. Replace the old ngrok URL with the new one in "URI de redirection autorisés"
4. Save changes

### 4. **Restart Services**
```bash
# Restart Express server
cd google-auth-service
npm start

# Restart Expo if needed
cd ..
npx expo start --clear
```

## 🎯 **Alternative: Permanent Solutions**

### **Option A: ngrok Paid Plan** 
- Get fixed subdomain: `yourapp.ngrok.io`
- No more domain updates needed
- ~$8-10/month

### **Option B: Local Network Testing**
For quick testing without external domains:
1. Use your computer's IP: `http://10.10.150.255:3001`
2. Test authentication by opening browser on your computer
3. Manually complete the flow

### **Option C: Deploy to Cloud** 
Deploy your auth service to Heroku/Vercel for a permanent domain.

## 🔧 **Current Ngrok Domain**
Last used: `https://e5cb-37-26-187-6.ngrok-free.app`
Update this file when you change domains for team reference. 