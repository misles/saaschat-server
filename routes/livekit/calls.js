// saaschat-server/routes/livekit/calls.js
const express = require('express');
const router = express.Router();
const CallManager = require('../../services/call-manager');

module.exports = function(db) {
  const callManager = new CallManager(db);

  /**
   * POST /api/livekit/calls/agent-initiate
   * Agent initiates call to user
   */
  router.post('/agent-initiate', async (req, res) => {
    try {
      const { agent_id, request_id, call_type = 'audio' } = req.body;

      if (!agent_id || !request_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id and request_id are required'
        });
      }

      const result = await callManager.agentInitiateCall(agent_id, request_id, call_type);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(403).json(result);
      }

    } catch (error) {
      console.error('🚨 Agent initiate call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/livekit/calls/user-request
   * User requests to call agent
   */
  router.post('/user-request', async (req, res) => {
    try {
      const { user_id, request_id, call_type = 'audio' } = req.body;

      if (!user_id || !request_id) {
        return res.status(400).json({
          success: false,
          error: 'user_id and request_id are required'
        });
      }

      const result = await callManager.userRequestCall(user_id, request_id, call_type);
      res.json(result);

    } catch (error) {
      console.error('🚨 User request call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/livekit/calls/agent-accept
   * Agent accepts user's call request
   */
  router.post('/agent-accept', async (req, res) => {
    try {
      const { agent_id, call_id } = req.body;

      if (!agent_id || !call_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id and call_id are required'
        });
      }

      const result = await callManager.agentAcceptCall(agent_id, call_id);
      res.json(result);

    } catch (error) {
      console.error('🚨 Agent accept call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/livekit/calls/ai-initiate
   * AI agent initiates call
   */
  router.post('/ai-initiate', async (req, res) => {
    try {
      const { ai_agent_id, request_id, call_type = 'audio' } = req.body;

      if (!ai_agent_id || !request_id) {
        return res.status(400).json({
          success: false,
          error: 'ai_agent_id and request_id are required'
        });
      }

      const result = await callManager.aiInitiateCall(ai_agent_id, request_id, call_type);
      res.json(result);

    } catch (error) {
      console.error('🚨 AI initiate call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/livekit/calls/user-join
   * User joins an existing call
   */
  router.post('/user-join', async (req, res) => {
    try {
      const { user_id, call_id } = req.body;

      if (!user_id || !call_id) {
        return res.status(400).json({
          success: false,
          error: 'user_id and call_id are required'
        });
      }

      const result = await callManager.userJoinCall(user_id, call_id);
      res.json(result);

    } catch (error) {
      console.error('🚨 User join call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/livekit/calls/end
   * End a call
   */
  router.post('/end', async (req, res) => {
    try {
      const { call_id, ended_by = 'user' } = req.body;

      if (!call_id) {
        return res.status(400).json({
          success: false,
          error: 'call_id is required'
        });
      }

      const result = await callManager.endCall(call_id, ended_by);
      res.json(result);

    } catch (error) {
      console.error('🚨 End call error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/livekit/calls/agent-active
   * Get agent's active calls
   */
  router.get('/agent-active/:agent_id', async (req, res) => {
    try {
      const { agent_id } = req.params;
      
      if (!agent_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id is required'
        });
      }

      const result = await callManager.getAgentActiveCalls(agent_id);
      res.json(result);

    } catch (error) {
      console.error('🚨 Get agent active calls error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/livekit/calls/history/:agent_id
   * Get agent's call history
   */
  router.get('/history/:agent_id', async (req, res) => {
    try {
      const { agent_id } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      if (!agent_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id is required'
        });
      }

      const result = await callManager.getCallHistory(agent_id, parseInt(limit), parseInt(offset));
      res.json(result);

    } catch (error) {
      console.error('🚨 Get call history error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/livekit/calls/status/:call_id
   * Get call status
   */
  router.get('/status/:call_id', async (req, res) => {
    try {
      const { call_id } = req.params;
      
      // Import CallSession model
      const CallSession = require('../../models/call-session');
      const callSession = await CallSession.findOne({ call_id });
      
      if (!callSession) {
        return res.status(404).json({
          success: false,
          error: 'Call not found'
        });
      }

      // Get LiveKit room info
      let roomInfo = null;
      let participants = [];
      
      try {
        const rooms = await callManager.roomService.listRooms([callSession.room_name]);
        if (rooms.length > 0) {
          roomInfo = rooms[0];
          const livekitParticipants = await callManager.roomService.listParticipants(callSession.room_name);
          participants = livekitParticipants.map(p => ({
            identity: p.identity,
            name: p.name,
            joined_at: p.joinedAt,
            is_speaking: p.isSpeaking
          }));
        }
      } catch (roomError) {
        console.warn('Could not fetch LiveKit room info:', roomError.message);
      }

      res.json({
        success: true,
        call: callSession.toObject(),
        livekit: roomInfo ? {
          room_name: roomInfo.name,
          num_participants: roomInfo.numParticipants,
          participants,
          created_at: roomInfo.creationTime
        } : null,
        is_active: callSession.status === 'active',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('🚨 Get call status error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};