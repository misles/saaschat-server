// D:\tiledesk\saaschat-server\routes\project-call-features.js
const express = require('express');
const router = express.Router();
const ProjectCallService = require('../services/project-call-service');

module.exports = function(db) {
  const projectCallService = new ProjectCallService(db);

  /**
   * GET /api/v1/projects/:projectId/call-features
   * Get call features for a project
   */
  router.get('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      
      const result = await projectCallService.getProjectCallFeatures(projectId);
      
      if (result.success) {
        res.json({
          success: true,
          data: result.data,
          message: result.message
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
      
    } catch (error) {
      console.error('Error in GET call-features:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * PUT /api/v1/projects/:projectId/call-features
   * Update call features for a project
   */
  router.put('/:projectId', async (req, res) => {
    try {
      const { projectId } = req.params;
      const updates = req.body;
      
      // Get current features
      const currentResult = await projectCallService.getProjectCallFeatures(projectId, false);
      if (!currentResult.success) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      // Update settings
      const projectFeatures = currentResult.data;
      
      if (updates.settings) {
        // Merge settings
        projectFeatures.settings = {
          ...projectFeatures.settings,
          ...updates.settings,
          updated_at: new Date()
        };
      }
      
      if (updates.sync_with_agents !== undefined) {
        projectFeatures.sync_with_agents = updates.sync_with_agents;
      }
      
      if (updates.auto_sync_new_agents !== undefined) {
        projectFeatures.auto_sync_new_agents = updates.auto_sync_new_agents;
      }
      
      // Save updates
      await projectFeatures.save();
      
      // Auto-sync to agents if enabled
      let syncResult = null;
      if (projectFeatures.sync_with_agents && updates.settings) {
        syncResult = await projectCallService.syncToAgents(projectId, projectFeatures);
      }
      
      res.json({
        success: true,
        data: projectFeatures,
        sync_result: syncResult,
        message: 'Call features updated successfully'
      });
      
    } catch (error) {
      console.error('Error in PUT call-features:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/projects/:projectId/call-features/sync
   * Sync project features to all agents
   */
  router.post('/:projectId/sync', async (req, res) => {
    try {
      const { projectId } = req.params;
      const { force = false } = req.body;
      
      // Get project features
      const result = await projectCallService.getProjectCallFeatures(projectId, false);
      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      const syncResult = await projectCallService.syncToAgents(projectId, result.data);
      
      res.json({
        success: true,
        project_id: projectId,
        result: syncResult,
        message: syncResult.success ? 
          `Synced features to ${syncResult.results.synced} agents` :
          'Sync failed'
      });
      
    } catch (error) {
      console.error('Error syncing features:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/v1/projects/:projectId/call-features/usage
   * Get usage statistics
   */
  router.get('/:projectId/usage', async (req, res) => {
    try {
      const { projectId } = req.params;
      
      const result = await projectCallService.getProjectCallFeatures(projectId, false);
      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: 'Project not found'
        });
      }
      
      // Calculate remaining calls
      const projectFeatures = result.data;
      const settings = projectFeatures.settings;
      const usage = projectFeatures.usage;
      
      const usageData = {
        current_month: {
          calls: usage.calls_this_month,
          minutes: usage.total_call_minutes,
          concurrent_now: usage.concurrent_calls_now
        },
        limits: {
          max_concurrent: settings.max_concurrent_calls,
          max_monthly: settings.monthly_call_limit,
          max_duration: settings.max_call_duration
        },
        remaining: {
          calls: settings.monthly_call_limit > 0 ? 
            Math.max(0, settings.monthly_call_limit - usage.calls_this_month) : 
            'unlimited',
          concurrent: Math.max(0, settings.max_concurrent_calls - usage.concurrent_calls_now)
        },
        last_reset: usage.last_reset_date,
        next_reset: new Date(usage.last_reset_date).setMonth(new Date(usage.last_reset_date).getMonth() + 1)
      };
      
      res.json({
        success: true,
        data: usageData,
        message: 'Usage statistics retrieved'
      });
      
    } catch (error) {
      console.error('Error getting usage:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/projects/:projectId/call-features/test-call
   * Test call functionality
   */
  router.post('/:projectId/test-call', async (req, res) => {
    try {
      const { projectId } = req.params;
      const { call_type = 'audio' } = req.body;
      
      // Check if call is allowed
      const canCall = await projectCallService.canMakeCall(projectId, call_type);
      
      if (!canCall.allowed) {
        return res.json({
          success: false,
          allowed: false,
          reason: canCall.reason,
          message: `Test call not allowed: ${canCall.reason}`
        });
      }
      
      // Simulate a test call (no actual call, just permission check)
      await projectCallService.recordCallUsage(projectId, 30); // 30 second test call
      
      // Simulate call ending after delay
      setTimeout(async () => {
        await projectCallService.endCall(projectId);
      }, 1000);
      
      res.json({
        success: true,
        allowed: true,
        test_call: {
          type: call_type,
          duration: 30,
          simulated: true,
          timestamp: new Date().toISOString()
        },
        message: 'Test call simulation successful'
      });
      
    } catch (error) {
      console.error('Error in test call:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/projects/:projectId/call-features/reset-usage
   * Reset usage statistics (admin only)
   */
  router.post('/:projectId/reset-usage', async (req, res) => {
    try {
      const { projectId } = req.params;
      
      const resetResult = await projectCallService.resetMonthlyUsage(projectId);
      
      if (resetResult.success) {
        res.json({
          success: true,
          message: 'Usage statistics reset successfully',
          reset_date: new Date().toISOString()
        });
      } else {
        res.status(500).json({
          success: false,
          error: resetResult.error
        });
      }
      
    } catch (error) {
      console.error('Error resetting usage:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};