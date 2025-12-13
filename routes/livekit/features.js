// saaschat-server/routes/livekit/features.js
const express = require('express');
const router = express.Router();
const LiveKitHelpers = require('../../lib/livekit-helpers');

module.exports = function(db) {
  const livekitHelpers = new LiveKitHelpers(db);

  /**
   * GET /api/livekit/features/:agentId
   * Get LiveKit features for an agent
   */
  router.get('/features/:agentId', async (req, res) => {
    try {
      const { agentId } = req.params;
      
      // First try to get from Tiledesk (fast)
      const tiledeskData = await livekitHelpers.getFromTiledesk(agentId);
      
      // If not found in Tiledesk, fetch from Supabase and sync
      if (!tiledeskData.success || tiledeskData.source === 'not_found') {
        console.log(`🔄 Features not found in Tiledesk for ${agentId}, fetching from Supabase...`);
        
        const supabaseData = await livekitHelpers.fetchFromSupabase(agentId);
        await livekitHelpers.syncToTiledesk(agentId, supabaseData.plan, supabaseData.features);
        
        return res.json({
          agent_id: agentId,
          plan: supabaseData.plan,
          features: supabaseData.features,
          source: supabaseData.source,
          synced_at: new Date().toISOString(),
          cache_status: 'miss'
        });
      }

      // Return from Tiledesk cache
      res.json({
        agent_id: agentId,
        plan: tiledeskData.plan,
        features: tiledeskData.features,
        source: tiledeskData.source,
        synced_at: tiledeskData.synced_at,
        cache_status: 'hit'
      });

    } catch (error) {
      console.error('Error fetching LiveKit features:', error);
      res.status(500).json({ 
        error: 'Failed to fetch LiveKit features',
        details: error.message 
      });
    }
  });

  /**
   * GET /api/livekit/check-permission
   * Check if agent has specific LiveKit permission
   */
  router.get('/check-permission', async (req, res) => {
    try {
      const { agent_id, permission } = req.query;
      
      if (!agent_id || !permission) {
        return res.status(400).json({
          error: 'agent_id and permission are required'
        });
      }

      const tiledeskData = await livekitHelpers.getFromTiledesk(agent_id);
      const allowed = tiledeskData.features[permission] || false;

      res.json({
        agent_id,
        permission,
        allowed,
        checked_at: new Date().toISOString()
      });

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};