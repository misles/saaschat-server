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
    host: process.env.LIVEKIT_HOST || 'live.wrapzil.com',
    apiKey: process.env.LIVEKIT_API_KEY || 'livekit-d204c911210f2c312c31a3619d4bf3c4',
    apiSecret: process.env.LIVEKIT_API_SECRET || '157c120cd8ea8ccb3f425d4a38dc43bcc782fa996e4aae141e4618895e6348ac',
    webhookSecret: process.env.LIVEKIT_WEBHOOK_SECRET || 'development-secret'
  },
  // Feature flags
  features: {
    enableLiveKit: true
  }
};