// saaschat-server/models/call-session.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const callSessionSchema = new Schema({
  // Core identifiers
  call_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  room_name: {
    type: String,
    required: true,
    index: true
  },
  
  // Tiledesk references
  tiledesk_request_id: {
    type: String,
    required: true,
    index: true
  },
  tiledesk_agent_id: {
    type: String,
    required: true,
    index: true
  },
  tiledesk_project_id: {
    type: String,
    index: true
  },
  
  // Participants
  initiator: {
    type: String,
    enum: ['agent', 'user', 'ai'],
    required: true
  },
  initiator_id: String,
  
  participants: [{
    identity: String,
    name: String,
    type: {
      type: String,
      enum: ['agent', 'user', 'ai']
    },
    joined_at: Date,
    left_at: Date,
    duration: Number
  }],
  
  // Call details
  call_type: {
    type: String,
    enum: ['audio', 'video', 'screen_share'],
    default: 'audio'
  },
  status: {
    type: String,
    enum: ['pending', 'ringing', 'active', 'ended', 'missed', 'rejected', 'cancelled'],
    default: 'pending'
  },
  
  // Timestamps
  created_at: {
    type: Date,
    default: Date.now
  },
  started_at: Date,
  ended_at: Date,
  
  // Duration tracking
  duration_seconds: Number,
  
  // Call quality metrics
  quality_metrics: {
    audio_score: Number,
    video_score: Number,
    packet_loss: Number,
    jitter: Number
  },
  
  // Recording info
  recording: {
    enabled: Boolean,
    url: String,
    duration: Number
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Index for faster queries
callSessionSchema.index({ tiledesk_request_id: 1, status: 1 });
callSessionSchema.index({ tiledesk_agent_id: 1, created_at: -1 });
callSessionSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model('CallSession', callSessionSchema);