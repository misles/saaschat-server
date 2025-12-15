// saaschat-server/services/call-manager.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const config = require('../config');
const LiveKitHelpers = require('../lib/livekit-helpers');
const { v4: uuidv4 } = require('uuid');

class CallManager {
  constructor(db) {
    this.helpers = new LiveKitHelpers(db);
    
    // Initialize LiveKit
    const livekitUrl = `https://${config.livekit.host || 'live.wrapzil.com'}`;
    this.roomService = new RoomServiceClient(
      livekitUrl,
      config.livekit.apiKey,
      config.livekit.apiSecret
    );
    
    this.livekitHost = process.env.LIVEKIT_HOST || 'live.wrapzil.com';
    this.wsUrl = `wss://${this.livekitHost}`;
    
    // Active calls cache
    this.activeCalls = new Map();
  }

  /**
   * AGENT INITIATES CALL TO USER
   */
  async agentInitiateCall(agentId, requestId, callType = 'audio') {
    try {
      console.log(`📞 Agent ${agentId} initiating ${callType} call for request ${requestId}`);
      
      // 1. Check agent permissions
      const agentFeatures = await this.helpers.getFromTiledesk(agentId);
      if (!this.canAgentInitiateCall(agentFeatures, callType)) {
        throw new Error(`Agent does not have permission for ${callType} calls`);
      }
      
      // 2. Import CallSession dynamically to avoid circular dependency
      const CallSession = require('../models/call-session');
      
      // 3. Create call session
      const callSession = await CallSession.create({
        call_id: `call_${uuidv4()}`,
        tiledesk_request_id: requestId,
        tiledesk_agent_id: agentId,
        initiator: 'agent',
        initiator_id: agentId,
        call_type: callType,
        status: 'pending',
        participants: [{
          identity: `agent_${agentId}`,
          name: 'Support Agent',
          type: 'agent'
        }]
      });
      
      // 4. Create LiveKit room
      const roomName = `td_call_${callSession.call_id}`;
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: agentFeatures.features.max_participants || 2,
        metadata: JSON.stringify({
          call_id: callSession.call_id,
          tiledesk_request_id: requestId,
          initiator: 'agent',
          agent_id: agentId,
          call_type: callType
        })
      });
      
      // 5. Update session with room info
      callSession.room_name = room.name;
      await callSession.save();
      
      // 6. Generate token for agent
      const agentToken = this.generateParticipantToken(
        `agent_${agentId}`,
        'Support Agent',
        room.name,
        true, // Agent is admin
        callType
      );
      
      // 7. Store in active calls
      this.activeCalls.set(callSession.call_id, {
        session: callSession,
        room: room,
        participants: new Map()
      });
      
      console.log(`✅ Agent call initiated. Call ID: ${callSession.call_id}`);
      
      return {
        success: true,
        call_id: callSession.call_id,
        room_name: room.name,
        agent_token: agentToken,
        ws_url: this.wsUrl,
        session: callSession.toObject()
      };
      
    } catch (error) {
      console.error('❌ Agent call initiation failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * USER REQUEST TO CALL AGENT
   */
  async userRequestCall(userId, requestId, callType = 'audio') {
    try {
      console.log(`📞 User ${userId} requesting ${callType} call for request ${requestId}`);
      
      // 1. Find available agent for this request
      const agentId = await this.findAvailableAgent(requestId);
      if (!agentId) {
        throw new Error('No available agent for this request');
      }
      
      // 2. Check if agent accepts this call type
      const agentFeatures = await this.helpers.getFromTiledesk(agentId);
      if (!this.canAgentReceiveCall(agentFeatures, callType)) {
        throw new Error('Agent does not accept this type of calls');
      }
      
      // 3. Import CallSession
      const CallSession = require('../models/call-session');
      
      // 4. Create call session
      const callSession = await CallSession.create({
        call_id: `call_${uuidv4()}`,
        tiledesk_request_id: requestId,
        tiledesk_agent_id: agentId,
        initiator: 'user',
        initiator_id: userId,
        call_type: callType,
        status: 'ringing', // User initiated, waiting for agent
        participants: [{
          identity: `user_${userId}`,
          name: 'Customer',
          type: 'user'
        }]
      });
      
      // 5. Create LiveKit room (but don't let agent join yet)
      const roomName = `td_call_${callSession.call_id}`;
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: agentFeatures.features.max_participants || 2,
        metadata: JSON.stringify({
          call_id: callSession.call_id,
          tiledesk_request_id: requestId,
          initiator: 'user',
          user_id: userId,
          agent_id: agentId,
          call_type: callType,
          status: 'ringing'
        })
      });
      
      // 6. Update session
      callSession.room_name = room.name;
      await callSession.save();
      
      // 7. Generate token for user (agent needs to accept first)
      const userToken = this.generateParticipantToken(
        `user_${userId}`,
        'Customer',
        room.name,
        false, // User is not admin
        callType
      );
      
      // 8. Store call
      this.activeCalls.set(callSession.call_id, {
        session: callSession,
        room: room,
        participants: new Map()
      });
      
      console.log(`✅ User call requested. Call ID: ${callSession.call_id}, Waiting for agent ${agentId}`);
      
      return {
        success: true,
        call_id: callSession.call_id,
        room_name: room.name,
        user_token: userToken,
        ws_url: this.wsUrl,
        agent_id: agentId,
        status: 'ringing',
        session: callSession.toObject()
      };
      
    } catch (error) {
      console.error('❌ User call request failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * AGENT ACCEPTS USER'S CALL REQUEST
   */
  async agentAcceptCall(agentId, callId) {
    try {
      console.log(`✅ Agent ${agentId} accepting call ${callId}`);
      
      // 1. Import CallSession
      const CallSession = require('../models/call-session');
      
      // 2. Get call session
      const callSession = await CallSession.findOne({ call_id: callId });
      if (!callSession) {
        throw new Error('Call not found');
      }
      
      // 3. Verify this agent is assigned to this call
      if (callSession.tiledesk_agent_id !== agentId) {
        throw new Error('Agent not assigned to this call');
      }
      
      // 4. Update call status
      callSession.status = 'active';
      callSession.started_at = new Date();
      callSession.participants.push({
        identity: `agent_${agentId}`,
        name: 'Support Agent',
        type: 'agent',
        joined_at: new Date()
      });
      await callSession.save();
      
      // 5. Generate token for agent
      const agentToken = this.generateParticipantToken(
        `agent_${agentId}`,
        'Support Agent',
        callSession.room_name,
        true, // Agent is admin
        callSession.call_type
      );
      
      // 6. Update active calls
      const activeCall = this.activeCalls.get(callId);
      if (activeCall) {
        activeCall.session = callSession;
        activeCall.participants.set(`agent_${agentId}`, {
          identity: `agent_${agentId}`,
          type: 'agent',
          joined_at: new Date()
        });
      }
      
      console.log(`✅ Agent ${agentId} accepted call ${callId}`);
      
      return {
        success: true,
        call_id: callId,
        room_name: callSession.room_name,
        agent_token: agentToken,
        ws_url: this.wsUrl,
        session: callSession.toObject()
      };
      
    } catch (error) {
      console.error('❌ Agent accept call failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * AI AGENT INITIATES/RECEIVES CALL
   */
  async aiInitiateCall(aiAgentId, requestId, callType = 'audio') {
    try {
      console.log(`🤖 AI Agent ${aiAgentId} initiating ${callType} call`);
      
      // 1. Import CallSession
      const CallSession = require('../models/call-session');
      
      // 2. Create call session
      const callSession = await CallSession.create({
        call_id: `call_${uuidv4()}`,
        tiledesk_request_id: requestId,
        tiledesk_agent_id: aiAgentId,
        initiator: 'ai',
        initiator_id: aiAgentId,
        call_type: callType,
        status: 'active', // AI calls start immediately
        participants: [{
          identity: `ai_${aiAgentId}`,
          name: 'AI Assistant',
          type: 'ai',
          joined_at: new Date()
        }]
      });
      
      // 3. Create LiveKit room
      const roomName = `td_call_${callSession.call_id}`;
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 300,
        maxParticipants: 2,
        metadata: JSON.stringify({
          call_id: callSession.call_id,
          tiledesk_request_id: requestId,
          initiator: 'ai',
          ai_agent_id: aiAgentId,
          call_type: callType
        })
      });
      
      // 4. Update session
      callSession.room_name = room.name;
      await callSession.save();
      
      // 5. Generate token for AI (AI system will use this)
      const aiToken = this.generateParticipantToken(
        `ai_${aiAgentId}`,
        'AI Assistant',
        room.name,
        true, // AI is admin
        callType
      );
      
      // 6. Store call
      this.activeCalls.set(callSession.call_id, {
        session: callSession,
        room: room,
        participants: new Map()
      });
      
      console.log(`✅ AI call initiated. Call ID: ${callSession.call_id}`);
      
      return {
        success: true,
        call_id: callSession.call_id,
        room_name: room.name,
        ai_token: aiToken,
        ws_url: this.wsUrl,
        session: callSession.toObject()
      };
      
    } catch (error) {
      console.error('❌ AI call initiation failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * USER JOINS A CALL (after invitation or request)
   */
  async userJoinCall(userId, callId) {
    try {
      const CallSession = require('../models/call-session');
      const callSession = await CallSession.findOne({ call_id: callId });
      if (!callSession) {
        throw new Error('Call not found');
      }
      
      // Generate token for user
      const userToken = this.generateParticipantToken(
        `user_${userId}`,
        'Customer',
        callSession.room_name,
        false,
        callSession.call_type
      );
      
      // Update session
      callSession.participants.push({
        identity: `user_${userId}`,
        name: 'Customer',
        type: 'user',
        joined_at: new Date()
      });
      await callSession.save();
      
      // Update active calls
      const activeCall = this.activeCalls.get(callId);
      if (activeCall) {
        activeCall.participants.set(`user_${userId}`, {
          identity: `user_${userId}`,
          type: 'user',
          joined_at: new Date()
        });
      }
      
      return {
        success: true,
        call_id: callId,
        room_name: callSession.room_name,
        user_token: userToken,
        ws_url: this.wsUrl,
        session: callSession.toObject()
      };
      
    } catch (error) {
      console.error('❌ User join call failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * END A CALL
   */
  async endCall(callId, endedBy = 'system') {
    try {
      const CallSession = require('../models/call-session');
      const callSession = await CallSession.findOne({ call_id: callId });
      if (!callSession) {
        throw new Error('Call not found');
      }
      
      // Update call session
      callSession.status = 'ended';
      callSession.ended_at = new Date();
      
      // Calculate duration
      if (callSession.started_at) {
        callSession.duration_seconds = 
          Math.floor((callSession.ended_at - callSession.started_at) / 1000);
      }
      
      // Update participants' left times
      callSession.participants.forEach(p => {
        if (p.joined_at && !p.left_at) {
          p.left_at = callSession.ended_at;
          p.duration = Math.floor((callSession.ended_at - p.joined_at) / 1000);
        }
      });
      
      await callSession.save();
      
      // End LiveKit room
      try {
        await this.roomService.deleteRoom(callSession.room_name);
      } catch (roomError) {
        console.warn(`⚠️ Could not delete LiveKit room: ${roomError.message}`);
      }
      
      // Remove from active calls
      this.activeCalls.delete(callId);
      
      console.log(`✅ Call ${callId} ended by ${endedBy}. Duration: ${callSession.duration_seconds}s`);
      
      return {
        success: true,
        call_id: callId,
        duration: callSession.duration_seconds,
        ended_by: endedBy
      };
      
    } catch (error) {
      console.error('❌ End call failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * GET ACTIVE CALLS FOR AGENT
   */
  async getAgentActiveCalls(agentId) {
    try {
      const CallSession = require('../models/call-session');
      const activeCalls = await CallSession.find({
        tiledesk_agent_id: agentId,
        status: { $in: ['pending', 'ringing', 'active'] }
      }).sort({ created_at: -1 }).limit(10);
      
      return {
        success: true,
        calls: activeCalls.map(call => call.toObject()),
        count: activeCalls.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * GET CALL HISTORY
   */
  async getCallHistory(agentId, limit = 20, offset = 0) {
    try {
      const CallSession = require('../models/call-session');
      const calls = await CallSession.find({
        tiledesk_agent_id: agentId,
        status: 'ended'
      })
      .sort({ ended_at: -1 })
      .skip(offset)
      .limit(limit);
      
      const total = await CallSession.countDocuments({
        tiledesk_agent_id: agentId,
        status: 'ended'
      });
      
      return {
        success: true,
        calls: calls.map(call => call.toObject()),
        total,
        limit,
        offset
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * HELPER: Generate participant token
   */
  generateParticipantToken(identity, name, roomName, isAdmin = false, callType = 'audio') {
    const at = new AccessToken(
      config.livekit.apiKey,
      config.livekit.apiSecret,
      {
        identity,
        name,
        ttl: '2h'
      }
    );

    const grant = {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishAudio: callType === 'audio' || callType === 'video',
      canPublishVideo: callType === 'video',
      canPublishData: true,
      canUpdateOwnMetadata: true
    };

    if (isAdmin) {
      grant.roomAdmin = true;
      grant.roomCreate = true;
    }

    at.addGrant(grant);
    return at.toJwt();
  }

  /**
   * HELPER: Check if agent can initiate call
   */
  canAgentInitiateCall(agentFeatures, callType) {
    const features = agentFeatures.features;
    
    if (callType === 'audio' && !features.audio) return false;
    if (callType === 'video' && !features.video) return false;
    if (callType === 'screen_share' && !features.screen_share) return false;
    
    return true;
  }

  /**
   * HELPER: Check if agent can receive call
   */
  canAgentReceiveCall(agentFeatures, callType) {
    return this.canAgentInitiateCall(agentFeatures, callType);
  }

  /**
   * HELPER: Find available agent for request
   */
  async findAvailableAgent(requestId) {
    // TODO: Implement agent availability logic
    // For now, return a dummy agent ID
    // You should implement your own logic here
    return 'agent_123'; // Replace with real logic
  }
}

module.exports = CallManager;