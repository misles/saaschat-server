// saaschat-server/config/index.js
module.exports = {
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  },
  server: {
    port: process.env.PORT || 3000,
    baseUrl: process.env.SERVER_PUBLIC_BASE_URL || 'http://localhost:3000',
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  mongo: {
    uri: process.env.MONGODB_URI
  },
  // LiveKit specific
  livekit: {
    webhookSecret: process.env.LIVEKIT_WEBHOOK_SECRET || 'development-secret'
  },
  // Feature flags
  features: {
    enableLiveKit: true
  }
};