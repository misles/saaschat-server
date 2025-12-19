const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const projectCallFeaturesSchema = new Schema({
  project_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Project-level settings (override agent features)
  settings: {
    // Feature toggles
    enabled: { type: Boolean },
    audio_calls: { type: Boolean },
    video_calls: { type: Boolean },
    screen_sharing: { type: Boolean, default: false },
    call_recording: { type: Boolean, default: false },
    
    // Limits
    max_concurrent_calls: { type: Number, default: 1, min: 0, max: 100 },
    max_call_duration: { type: Number, default: 1800 }, // seconds
    monthly_call_limit: { type: Number, default: 100 },
    
    // Quality settings
    video_quality: { 
      type: String, 
      enum: ['low', 'medium', 'high', 'hd'],
      default: 'medium'
    },
    audio_quality: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    
    // LiveKit settings (can override default)
    livekit_server: { type: String },
    turn_servers: [{ type: String }],
    
    // UI settings
    show_call_button: { type: Boolean, default: true },
    require_precall_test: { type: Boolean, default: false }
  },
  
  // Usage tracking
  usage: {
    calls_this_month: { type: Number, default: 0 },
    total_call_minutes: { type: Number, default: 0 },
    concurrent_calls_now: { type: Number, default: 0 },
    last_reset_date: { type: Date, default: Date.now }
  },
  
  // Sync settings
  sync_with_agents: { type: Boolean, default: true },
  auto_sync_new_agents: { type: Boolean, default: true },
  
  // Metadata
  created_by: String,
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  last_synced_at: Date
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Indexes
projectCallFeaturesSchema.index({ project_id: 1 });
projectCallFeaturesSchema.index({ 'settings.enabled': 1 });
projectCallFeaturesSchema.index({ updated_at: -1 });

module.exports = mongoose.model('ProjectCallFeatures', projectCallFeaturesSchema, 'project_call_features');