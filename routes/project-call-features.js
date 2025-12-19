const express = require('express');
const router = express.Router({ mergeParams: true });

module.exports = function(db) {
  console.log('PROJECT-CALL-FEATURES: Router factory initialized');
  
  // Import dependencies
  const passport = require('passport');
  const validtoken = require('../middleware/valid-token');
  const roleChecker = require('../middleware/has-role');
  
  let projectCallService;
  try {
    const ProjectCallService = require('../services/project-call-service');
    projectCallService = new ProjectCallService(db);
    console.log('PROJECT-CALL-FEATURES: ✅ Service initialized successfully');
  } catch (error) {
    console.error('PROJECT-CALL-FEATURES: ❌ Failed to initialize ProjectCallService:', error.message);
    projectCallService = null;
  }

  // Helper function to handle service unavailable
  const serviceCheck = (req, res, next) => {
    if (!projectCallService) {
      return res.status(503).json({
        success: false,
        error: 'Service unavailable',
        message: 'Project call service is not initialized'
      });
    }
    next();
  };

  /**
   * GET /:projectid/call-features
   * Get call features for a project
   * Authentication: Agent or higher
   */
  router.get('/', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRoleOrTypes('agent', ['bot', 'subscription']),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: GET features for project:', projectId);
      
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
      console.error('PROJECT-CALL-FEATURES: ❌ Error getting call features:', error.message);
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
   * Authentication: Admin only
   */
  router.put('/', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRole('admin'),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const updates = req.body;
      
      console.log('PROJECT-CALL-FEATURES: PUT update for project:', projectId);
      
      // Validate updates
      if (!updates || (typeof updates !== 'object')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid update data',
          message: 'Request body must contain update data'
        });
      }
      
      const result = await projectCallService.updateProjectCallFeatures(projectId, updates);
      
      if (result.success) {
        res.json({
          success: true,
          data: result.data,
          message: result.message || 'Project call features updated successfully'
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error('PROJECT-CALL-FEATURES: ❌ Error updating call features:', error.message);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to update project call features'
      });
    }
  });

  /**
   * GET /:projectid/call-features/usage
   * Get usage statistics
   * Authentication: Agent or higher
   */
  router.get('/usage', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRoleOrTypes('agent', ['bot', 'subscription']),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: GET usage for project:', projectId);
      
      const result = await projectCallService.getProjectCallFeatures(projectId, false);
      
      if (result.success) {
        const features = result.data;
        const settings = features.settings || {};
        const usage = features.usage || {};
        
        const usageData = {
          current_month: {
            calls: usage.calls_this_month || 0,
            minutes: usage.total_call_minutes || 0,
            concurrent_now: usage.concurrent_calls_now || 0
          },
          limits: {
            max_concurrent: settings.max_concurrent_calls || 1,
            max_monthly: settings.monthly_call_limit || 100,
            max_duration: settings.max_call_duration || 1800
          },
          remaining: {
            calls: settings.monthly_call_limit > 0 ? 
              Math.max(0, (settings.monthly_call_limit || 100) - (usage.calls_this_month || 0)) : 
              'unlimited',
            concurrent: Math.max(0, (settings.max_concurrent_calls || 1) - (usage.concurrent_calls_now || 0))
          },
          last_reset: usage.last_reset_date || new Date(),
          next_reset: new Date(usage.last_reset_date || new Date()).setMonth(
            new Date(usage.last_reset_date || new Date()).getMonth() + 1
          )
        };
        
        res.json({
          success: true,
          data: usageData,
          message: 'Usage statistics retrieved'
        });
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('PROJECT-CALL-FEATURES: ❌ Error getting usage:', error.message);
      res.status(500).json({
        success: false,
        error: error.message,
        message: 'Failed to retrieve usage statistics'
      });
    }
  });

  /**
   * POST /:projectid/call-features/test-call
   * Test call functionality
   * Authentication: Admin only
   */
  router.post('/test-call', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRole('admin'),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const { call_type = 'audio' } = req.body;
      
      console.log('PROJECT-CALL-FEATURES: Test call for project:', projectId, 'type:', call_type);
      
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
      console.error('PROJECT-CALL-FEATURES: ❌ Error in test call:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/reset-usage
   * Reset usage statistics
   * Authentication: Admin only
   */
  router.post('/reset-usage', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRole('admin'),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: Reset usage for project:', projectId);
      
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
      console.error('PROJECT-CALL-FEATURES: ❌ Error resetting usage:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/sync
   * Sync project features to agents
   * Authentication: Admin only
   */
  router.post('/sync', [
    passport.authenticate(['basic', 'jwt'], { session: false }),
    validtoken,
    roleChecker.hasRole('admin'),
    serviceCheck
  ], async (req, res) => {
    try {
      const projectId = req.params.projectid;
      console.log('PROJECT-CALL-FEATURES: Sync features for project:', projectId);
      
      // This would sync features to agents' Supabase profiles
      // For now, return a placeholder response
      
      res.json({
        success: true,
        message: 'Sync feature would update agent profiles',
        note: 'Implementation pending Supabase integration'
      });
    } catch (error) {
      console.error('PROJECT-CALL-FEATURES: ❌ Error syncing features:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};