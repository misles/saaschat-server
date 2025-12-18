const express = require('express');
const router = express.Router({ mergeParams: true });

module.exports = function(db) {
  console.log('PROJECT-CALL-FEATURES: Router factory called, db provided:', !!db);
  
  // If db is not provided, try to get it from mongoose
  if (!db) {
    try {
      const mongoose = require('mongoose');
      db = mongoose.connection.db;
      console.log('PROJECT-CALL-FEATURES: Got db from mongoose.connection.db:', !!db);
    } catch (error) {
      console.warn('PROJECT-CALL-FEATURES: Could not get mongoose connection:', error.message);
    }
  }

  let projectCallService;
  try {
    const ProjectCallService = require('../services/project-call-service');
    projectCallService = new ProjectCallService(db);
    console.log('PROJECT-CALL-FEATURES: Service initialized successfully');
  } catch (error) {
    console.error('PROJECT-CALL-FEATURES: Failed to initialize ProjectCallService:', error);
    projectCallService = null;
  }

  /**
   * GET /:projectid/call-features
   * Get call features for a project
   */
  router.get('/', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: Getting features for project:', projectId);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
      const result = await projectCallService.getProjectCallFeatures(projectId);
      
      if (result.success) {
        res.json({
          success: true,
          data: result.data,
          message: result.message || 'Project call features retrieved'
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error('PROJECT-CALL-FEATURES: Error getting call features:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to retrieve project call features'
      });
    }
  });

  /**
   * PUT /:projectid/call-features
   * Update call features for a project
   */
  router.put('/', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const updates = req.body;
      console.log('PROJECT-CALL-FEATURES: Updating features for project:', projectId, updates);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
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
      console.error('PROJECT-CALL-FEATURES: Error updating call features:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/sync
   * Sync project features to all agents
   */
  router.post('/sync', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const { force = false } = req.body;
      console.log('PROJECT-CALL-FEATURES: Syncing features for project:', projectId);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
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
      console.error('PROJECT-CALL-FEATURES: Error syncing features:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /:projectid/call-features/usage
   * Get usage statistics
   */
  router.get('/usage', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: Getting usage for project:', projectId);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
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
      console.error('PROJECT-CALL-FEATURES: Error getting usage:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/test-call
   * Test call functionality
   */
  router.post('/test-call', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const { call_type = 'audio' } = req.body;
      console.log('PROJECT-CALL-FEATURES: Test call for project:', projectId, call_type);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
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
      console.error('PROJECT-CALL-FEATURES: Error in test call:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/reset-usage
   * Reset usage statistics (admin only)
   */
  router.post('/reset-usage', async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: Reset usage for project:', projectId);
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: 'Service unavailable',
          message: 'Project call service is not initialized'
        });
      }
      
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
      console.error('PROJECT-CALL-FEATURES: Error resetting usage:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};