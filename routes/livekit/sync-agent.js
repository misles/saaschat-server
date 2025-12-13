// saaschat-server/routes/livekit/sync-agent.js
const express = require('express');
const router = express.Router();
const LiveKitHelpers = require('../../lib/livekit-helpers');

// Initialize with MongoDB connection
module.exports = function(db) {
  const livekitHelpers = new LiveKitHelpers(db);

  /**
   * POST /api/livekit/sync-agent
   * Sync agent features from Supabase to Tiledesk
   * Called from create-user.js after signup
   */
  router.post('/sync-agent', async (req, res) => {
    try {
      const { agent_id, source = 'manual', timestamp } = req.body;

      if (!agent_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id is required'
        });
      }

      console.log(`🔄 Syncing LiveKit features for agent: ${agent_id}, source: ${source}`);

      // 1. Fetch from Supabase
      const supabaseData = await livekitHelpers.fetchFromSupabase(agent_id);
      
      if (!supabaseData.success) {
        console.warn(`⚠️ Could not fetch from Supabase for ${agent_id}, using defaults`);
      }

      // 2. Sync to Tiledesk MongoDB
      const syncResult = await livekitHelpers.syncToTiledesk(
        agent_id,
        supabaseData.plan,
        supabaseData.features
      );

      if (!syncResult.success) {
        throw new Error(`Failed to sync to Tiledesk: ${syncResult.error}`);
      }

      // 3. Return success
      const response = {
        success: true,
        agent_id,
        synced_at: new Date().toISOString(),
        source,
        data: {
          plan: supabaseData.plan,
          features: supabaseData.features,
          fetched_from: supabaseData.source
        },
        sync_result: syncResult
      };

      console.log(`✅ LiveKit sync completed for ${agent_id}`);
      res.json(response);

    } catch (error) {
      console.error('🚨 LiveKit sync error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        agent_id: req.body.agent_id
      });
    }
  });

  /**
   * GET /api/livekit/sync-agent/:agentId
   * Manual trigger for sync (for debugging/admin)
   */
  router.get('/sync-agent/:agentId', async (req, res) => {
    try {
      const { agentId } = req.params;
      const result = await livekitHelpers.fetchFromSupabase(agentId);
      
      res.json({
        agent_id: agentId,
        fetched_at: new Date().toISOString(),
        ...result
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== NEW ENDPOINT ====================
  
  /**
   * POST /api/livekit/update-agent-features
   * UPDATE Supabase FIRST, then trigger sync
   * Called from Dashboard UI when admin changes features
   */
  router.post('/update-agent-features', async (req, res) => {
    try {
      const { agent_id, features, plan = 'custom' } = req.body;

      if (!agent_id) {
        return res.status(400).json({
          success: false,
          error: 'agent_id is required'
        });
      }

      if (!features || typeof features !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'features object is required'
        });
      }

      console.log(`📝 Updating LiveKit features for agent: ${agent_id}`);

      // 1. FIRST: Update Supabase
      const supabaseUpdate = await livekitHelpers.updateSupabaseFeatures(
        agent_id,
        plan,
        features
      );

      if (!supabaseUpdate.success) {
        console.error('❌ Supabase update failed:', supabaseUpdate.error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update Supabase',
          details: supabaseUpdate.error
        });
      }

      console.log(`✅ Supabase updated for ${agent_id}`);

      // 2. THEN: Trigger sync to Tiledesk
      const syncResult = await livekitHelpers.syncToTiledesk(
        agent_id,
        plan,
        features
      );

      if (!syncResult.success) {
        console.warn(`⚠️ Sync to Tiledesk had issues: ${syncResult.error}`);
        // Still return success since Supabase was updated
      }

      // 3. Return complete success
      const response = {
        success: true,
        agent_id,
        updated_at: new Date().toISOString(),
        source: 'dashboard',
        data: {
          plan,
          features,
          supabase_row: supabaseUpdate.data
        },
        sync_result: syncResult
      };

      console.log(`🎉 LiveKit features updated and synced for ${agent_id}`);
      res.json(response);

    } catch (error) {
      console.error('🚨 Update features error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        agent_id: req.body.agent_id
      });
    }
  });

  return router;
};