const express = require("express");
const router = express.Router({ mergeParams: true });

module.exports = function(db) {
  console.log("PROJECT-CALL-FEATURES: Router factory initialized");
  
  let projectCallService;
  try {
    const ProjectCallService = require("../services/project-call-service");
    projectCallService = new ProjectCallService(db);
    console.log("✅ ProjectCallService initialized");
  } catch (error) {
    console.error("❌ Failed to initialize ProjectCallService:", error.message);
    projectCallService = null;
  }

  /**
   * GET /:projectid/call-features
   * Get project call features
   */
  router.get("/", async (req, res) => {
    try {
      const projectId = req.params.projectid;
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: "Service unavailable",
          message: "Project call service is not initialized"
        });
      }
      
      const result = await projectCallService.getProjectCallFeatures(projectId);
      
      if (result.success) {
        res.json({
          success: true,
          data: result.data,
          message: result.message || "Project call features retrieved"
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error("PROJECT-CALL-FEATURES: Error in GET:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Failed to retrieve project call features"
      });
    }
  });

  /**
   * PUT /:projectid/call-features
   * Update project call features
   */
  router.put("/", async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const updates = req.body;
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: "Service unavailable"
        });
      }
      
      const result = await projectCallService.updateProjectCallFeatures(projectId, updates);
      
      if (result.success) {
        res.json({
          success: true,
          data: result.data,
          message: result.message || "Project call features updated"
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error("PROJECT-CALL-FEATURES: Error in PUT:", error);
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
  router.get("/usage", async (req, res) => {
    try {
      const projectId = req.params.projectid;
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: "Service unavailable"
        });
      }
      
      const result = await projectCallService.getProjectCallFeatures(projectId, false);
      
      if (result.success) {
        const features = result.data;
        const usageData = {
          current_month: {
            calls: features.usage?.calls_this_month || 0,
            minutes: features.usage?.total_call_minutes || 0,
            concurrent_now: features.usage?.concurrent_calls_now || 0
          },
          limits: {
            max_concurrent: features.settings?.max_concurrent_calls || 1,
            max_monthly: features.settings?.monthly_call_limit || 100,
            max_duration: features.settings?.max_call_duration || 1800
          },
          remaining: {
            calls: features.settings?.monthly_call_limit > 0 ? 
              Math.max(0, (features.settings.monthly_call_limit || 100) - (features.usage?.calls_this_month || 0)) : 
              "unlimited",
            concurrent: Math.max(0, (features.settings?.max_concurrent_calls || 1) - (features.usage?.concurrent_calls_now || 0))
          },
          last_reset: features.usage?.last_reset_date || new Date()
        };
        
        res.json({
          success: true,
          data: usageData,
          message: "Usage statistics retrieved"
        });
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error("PROJECT-CALL-FEATURES: Error in GET /usage:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /:projectid/call-features/increment-usage
   * Record call usage (internal use)
   */
  router.post("/increment-usage", async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const { duration_seconds = 0 } = req.body;
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: "Service unavailable"
        });
      }
      
      const result = await projectCallService.recordCallUsage(projectId, duration_seconds);
      
      if (result.success) {
        res.json({
          success: true,
          message: "Call usage recorded"
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      console.error("PROJECT-CALL-FEATURES: Error incrementing usage:", error);
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
  router.post("/test-call", async (req, res) => {
    try {
      const projectId = req.params.projectid;
      const { call_type = "audio" } = req.body;
      
      if (!projectCallService) {
        return res.status(503).json({
          success: false,
          error: "Service unavailable"
        });
      }
      
      const canCall = await projectCallService.canMakeCall(projectId, call_type);
      
      if (!canCall.allowed) {
        return res.json({
          success: false,
          allowed: false,
          reason: canCall.reason,
          message: `Test call not allowed: ${canCall.reason}`
        });
      }
      
      // Simulate call recording
      await projectCallService.recordCallUsage(projectId, 30);
      
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
        message: "Test call simulation successful"
      });
    } catch (error) {
      console.error("PROJECT-CALL-FEATURES: Error in test call:", error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
};