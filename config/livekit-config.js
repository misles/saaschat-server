// saaschat-server/config/livekit-config.js
const config = require('./index');

module.exports = {
  supabase: config.supabase,
  webhook: {
    secret: config.livekit.webhookSecret
  },
  tiledesk: {
    baseUrl: config.server.baseUrl
  },
  defaultFeatures: {
    audio: false,
    video: false,
    screen_share: false,
    image_share: false,
    file_share: false,
    max_participants: 2,
    max_call_minutes: 0
  }
};