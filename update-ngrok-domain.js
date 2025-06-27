#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the new ngrok domain from command line argument
const newDomain = process.argv[2];

if (!newDomain) {
  console.log('❌ Usage: node update-ngrok-domain.js <new-ngrok-domain>');
  console.log('   Example: node update-ngrok-domain.js https://abc123.ngrok-free.app');
  process.exit(1);
}

// Validate URL format
if (!newDomain.startsWith('https://') || !newDomain.includes('.ngrok-free.app')) {
  console.log('❌ Invalid ngrok domain format. Should be: https://xxxxx.ngrok-free.app');
  process.exit(1);
}

console.log(`🔄 Updating ngrok domain to: ${newDomain}`);

// Files to update
const filesToUpdate = [
  {
    path: '.env',
    replacements: [
      {
        search: /DEVELOPMENT_REDIRECT_URI=https:\/\/[^\/]+\.ngrok-free\.app/,
        replace: `DEVELOPMENT_REDIRECT_URI=${newDomain}`
      },
      {
        search: /PRODUCTION_REDIRECT_URI=https:\/\/[^\/]+\.ngrok-free\.app/,
        replace: `PRODUCTION_REDIRECT_URI=${newDomain}`
      }
    ]
  },
  {
    path: '../services/api.ts',
    replacements: [
      {
        search: /const GOOGLE_AUTH_SERVICE_URL = 'https:\/\/[^\/]+\.ngrok-free\.app'/,
        replace: `const GOOGLE_AUTH_SERVICE_URL = '${newDomain}'`
      }
    ]
  },
  {
    path: '../app/onboarding.tsx',
    replacements: [
      {
        search: /fetch\('https:\/\/[^\/]+\.ngrok-free\.app\/auth\/check-session'/,
        replace: `fetch('${newDomain}/auth/check-session'`
      }
    ]
  }
];

// Update each file
filesToUpdate.forEach(({ path: filePath, replacements }) => {
  const fullPath = path.resolve(__dirname, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let updated = false;

  replacements.forEach(({ search, replace }) => {
    if (search.test(content)) {
      content = content.replace(search, replace);
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(fullPath, content);
    console.log(`✅ Updated: ${filePath}`);
  } else {
    console.log(`⚠️  No changes needed: ${filePath}`);
  }
});

console.log('\n🎯 Next steps:');
console.log('1. Add this to Google Cloud Console:');
console.log(`   ${newDomain}/auth/google/success`);
console.log('2. Restart your Express server');
console.log('3. Test your mobile app');

console.log('\n📋 Google Cloud Console URL:');
console.log('https://console.cloud.google.com/apis/credentials'); 