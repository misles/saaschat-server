const mongoose = require("mongoose");

class ProjectCallService {
  constructor(db) {
    console.log("PROJECT-CALL-SERVICE: Initializing...");
    
    // Get the model
    try {
      this.ProjectCallFeatures = mongoose.model("ProjectCallFeatures");
      console.log("PROJECT-CALL-SERVICE: Model loaded successfully");
    } catch (error) {
      console.warn("PROJECT-CALL-SERVICE: Model not found, attempting to load...");
      try {
        require("../models/project-call-features");
        this.ProjectCallFeatures = mongoose.model("ProjectCallFeatures");
        console.log("PROJECT-CALL-SERVICE: Model loaded dynamically");
      } catch (loadError) {
        console.error("PROJECT-CALL-SERVICE: Failed to load model:", loadError.message);
        this.ProjectCallFeatures = null;
      }
    }
  }

  /**
   * Get project call features
   */
  async getProjectCallFeatures(projectId, checkSupabase = true) {
    try {
      // If model not available, return default
      if (!this.ProjectCallFeatures) {
        return {
          success: true,
          data: {
            project_id: projectId,
            settings: {
              enabled: false,
              audio_calls: true,
              video_calls: false,
              screen_sharing: false,
              call_recording: false,
              max_concurrent_calls: 1,
              max_call_duration: 1800,
              monthly_call_limit: 100,
              video_quality: "medium",
              audio_quality: "medium",
              show_call_button: true,
              require_precall_test: false
            },
            usage: {
              calls_this_month: 0,
              total_call_minutes: 0,
              concurrent_calls_now: 0,
              last_reset_date: new Date()
            }
          },
          message: "Default project call features (model not available)"
        };
      }
      
      // Get from database
      let projectFeatures = await this.ProjectCallFeatures.findOne({ project_id: projectId });
      
      if (!projectFeatures) {
        // Create default
        projectFeatures = new this.ProjectCallFeatures({
          project_id: projectId,
          settings: {
            enabled: false,
            audio_calls: true,
            video_calls: false,
            screen_sharing: false,
            call_recording: false,
            max_concurrent_calls: 1,
            max_call_duration: 1800,
            monthly_call_limit: 100,
            video_quality: "medium",
            audio_quality: "medium",
            show_call_button: true,
            require_precall_test: false
          }
        });
        await projectFeatures.save();
      }
      
      // If checking Supabase, verify subscription
      if (checkSupabase) {
        const supabaseCheck = await this.checkProjectSubscription(projectId);
        if (!supabaseCheck.valid) {
          projectFeatures.settings.enabled = false;
        }
      }
      
      return {
        success: true,
        data: projectFeatures,
        message: "Project call features retrieved"
      };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error getting features:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update project call features
   */
  async updateProjectCallFeatures(projectId, updates) {
    try {
      if (!this.ProjectCallFeatures) {
        return {
          success: false,
          error: "Database model not available"
        };
      }
      
      const result = await this.ProjectCallFeatures.findOneAndUpdate(
        { project_id: projectId },
        { 
          $set: { 
            ...updates,
            updated_at: new Date() 
          } 
        },
        { new: true, upsert: true }
      );
      
      return {
        success: true,
        data: result,
        message: "Project call features updated"
      };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error updating features:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if project has valid subscription
   */
  async checkProjectSubscription(projectId) {
    try {
      // Try to get Project model
      let ProjectModel;
      try {
        ProjectModel = mongoose.model("Project");
      } catch (e) {
        return {
          valid: true, // Assume valid if can't check
          reason: "Could not verify subscription",
          can_enable: true
        };
      }
      
      const project = await ProjectModel.findOne({ _id: projectId });
      
      if (!project) {
        return {
          valid: false,
          reason: "Project not found",
          can_enable: false
        };
      }
      
      // Check project profile for plan info
      const planName = project.profile?.name || "free";
      const planFeatures = this.getPlanFeatures(planName);
      
      return {
        valid: true,
        plan: planName,
        features: planFeatures,
        can_enable: planFeatures.allows_calls
      };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error checking subscription:", error);
      return {
        valid: false,
        reason: "Error checking subscription",
        can_enable: false
      };
    }
  }

  /**
   * Map plan names to call features
   */
  getPlanFeatures(planName) {
    const plans = {
      "free": {
        allows_calls: false,
        audio_calls: false,
        video_calls: false,
        max_concurrent_calls: 0,
        monthly_call_limit: 0
      },
      "basic": {
        allows_calls: true,
        audio_calls: true,
        video_calls: false,
        max_concurrent_calls: 1,
        monthly_call_limit: 100
      },
      "pro": {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        max_concurrent_calls: 2,
        monthly_call_limit: 500
      },
      "enterprise": {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        call_recording: true,
        max_concurrent_calls: 10,
        monthly_call_limit: -1
      },
      "custom": {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        call_recording: true,
        max_concurrent_calls: 1000,
        monthly_call_limit: -1
      }
    };
    
    return plans[planName.toLowerCase()] || plans["free"];
  }

  /**
   * Check if call can be made
   */
  async canMakeCall(projectId, callType = "audio") {
    try {
      const projectFeatures = await this.getProjectCallFeatures(projectId);
      
      if (!projectFeatures.success || !projectFeatures.data.settings.enabled) {
        return {
          allowed: false,
          reason: "Calls disabled for project"
        };
      }
      
      // Check specific feature
      const featureKey = callType === "video" ? "video_calls" : "audio_calls";
      if (!projectFeatures.data.settings[featureKey]) {
        return {
          allowed: false,
          reason: `${callType} calls disabled`
        };
      }
      
      // Check concurrent calls limit
      if (projectFeatures.data.usage.concurrent_calls_now >= 
          projectFeatures.data.settings.max_concurrent_calls) {
        return {
          allowed: false,
          reason: "Concurrent call limit reached"
        };
      }
      
      // Check monthly limit (if not unlimited)
      if (projectFeatures.data.settings.monthly_call_limit > 0 &&
          projectFeatures.data.usage.calls_this_month >= 
          projectFeatures.data.settings.monthly_call_limit) {
        return {
          allowed: false,
          reason: "Monthly call limit reached"
        };
      }
      
      return {
        allowed: true,
        project_features: projectFeatures.data
      };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error checking call permission:", error);
      return {
        allowed: false,
        reason: "Error checking permissions"
      };
    }
  }

  /**
   * Record call usage
   */
  async recordCallUsage(projectId, durationSeconds = 0) {
    try {
      if (!this.ProjectCallFeatures) {
        return { success: false, error: "Model not available" };
      }
      
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $inc: {
            "usage.calls_this_month": 1,
            "usage.total_call_minutes": Math.ceil(durationSeconds / 60),
            "usage.concurrent_calls_now": 1
          },
          $set: { updated_at: new Date() }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error recording call usage:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End call (decrement concurrent count)
   */
  async endCall(projectId) {
    try {
      if (!this.ProjectCallFeatures) {
        return { success: false, error: "Model not available" };
      }
      
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $inc: { "usage.concurrent_calls_now": -1 },
          $set: { updated_at: new Date() }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error ending call:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset monthly usage
   */
  async resetMonthlyUsage(projectId) {
    try {
      if (!this.ProjectCallFeatures) {
        return { success: false, error: "Model not available" };
      }
      
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $set: {
            "usage.calls_this_month": 0,
            "usage.total_call_minutes": 0,
            "usage.last_reset_date": new Date(),
            updated_at: new Date()
          }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: Error resetting usage:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ProjectCallService;