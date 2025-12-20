// services/project-call-service.js - COMPLETE VERSION WITH FIXED MERGE LOGIC
const mongoose = require("mongoose");

class ProjectCallService {
  constructor(db) {
    console.log("PROJECT-CALL-SERVICE: Constructor called");
    
    // Get the model - it should already be loaded in app.js
    try {
      this.ProjectCallFeatures = mongoose.model("ProjectCallFeatures");
      console.log("PROJECT-CALL-SERVICE: ✅ Model found");
    } catch (error) {
      console.log("PROJECT-CALL-SERVICE: ⚠️ Model not found:", error.message);
      this.ProjectCallFeatures = null;
    }
  }

  async getProjectCallFeatures(projectId, checkSupabase = true) {
    console.log("PROJECT-CALL-SERVICE: Getting features for:", projectId);
    
    // If model not available, return default
    if (!this.ProjectCallFeatures) {
      console.log("PROJECT-CALL-SERVICE: ⚠️ Using default data (no model)");
      return {
        success: true,
        data: {
          project_id: projectId,
          settings: {
            enabled: true,
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
    
    try {
      console.log("PROJECT-CALL-SERVICE: Querying database...");
      let projectFeatures = await this.ProjectCallFeatures.findOne({ project_id: projectId });
      
      if (!projectFeatures) {
        console.log("PROJECT-CALL-SERVICE: No record found, creating default...");
        projectFeatures = new this.ProjectCallFeatures({
          project_id: projectId,
          settings: {
            enabled: true,
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
        });
        await projectFeatures.save();
        console.log("PROJECT-CALL-SERVICE: ✅ Default features saved to database");
      } else {
        console.log("PROJECT-CALL-SERVICE: ✅ Found existing features in database");
      }
      
      return {
        success: true,
        data: projectFeatures,
        message: "Project call features retrieved from database"
      };
      
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: ❌ Database error:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async updateProjectCallFeatures(projectId, updates) {
    console.log("PROJECT-CALL-SERVICE: Updating features for:", projectId);
    console.log("PROJECT-CALL-SERVICE: Updates:", JSON.stringify(updates, null, 2));
    
    if (!this.ProjectCallFeatures) {
      return {
        success: false,
        error: "Model not available"
      };
    }
    
    try {
      // Get current document first
      const current = await this.ProjectCallFeatures.findOne({ project_id: projectId });
      console.log("PROJECT-CALL-SERVICE: Current exists:", !!current);
      
      // Start with update timestamp
      const setOperation = { updated_at: new Date() };
      
      // Handle settings merge with dot notation
      if (updates.settings && typeof updates.settings === "object") {
        let mergedSettings = {};
        
        // Get current settings if they exist
        if (current && current.settings) {
          const currentSettings = current.settings.toObject ? current.settings.toObject() : current.settings;
          mergedSettings = { ...currentSettings };
          console.log("PROJECT-CALL-SERVICE: Current settings loaded");
        }
        
        // Merge with new settings
        mergedSettings = { ...mergedSettings, ...updates.settings };
        console.log("PROJECT-CALL-SERVICE: Merged settings:", JSON.stringify(mergedSettings, null, 2));
        
        // Use dot notation for ALL settings fields
        for (const [key, value] of Object.entries(mergedSettings)) {
          setOperation[`settings.${key}`] = value;
        }
      }
      
      // Handle top-level fields
      for (const key in updates) {
        if (key !== "settings" && key !== "_id" && key !== "__v") {
          setOperation[key] = updates[key];
        }
      }
      
      console.log("PROJECT-CALL-SERVICE: Final $set operation:", JSON.stringify(setOperation, null, 2));
      
      // Perform update with dot notation
      const result = await this.ProjectCallFeatures.findOneAndUpdate(
        { project_id: projectId },
        { $set: setOperation },
        { new: true, upsert: true, setDefaultsOnInsert: false, strict: false, runValidators: false }
      );
      
      const resultSettings = result.settings.toObject ? result.settings.toObject() : result.settings;
      console.log("PROJECT-CALL-SERVICE: ✅ Update successful");
      console.log("PROJECT-CALL-SERVICE: Result settings keys:", Object.keys(resultSettings));
      console.log("PROJECT-CALL-SERVICE: Result has custom fields:", Object.keys(resultSettings).filter(k => !["enabled","audio_calls","video_calls","screen_sharing","call_recording","max_concurrent_calls","max_call_duration","monthly_call_limit","video_quality","audio_quality","turn_servers","show_call_button","require_precall_test"].includes(k)));
      return {
        success: true,
        data: result,
        message: "Project call features updated"
      };
    } catch (error) {
      console.error("PROJECT-CALL-SERVICE: ❌ Update error:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if project has valid subscription (from original code)
   */
  async checkProjectSubscription(projectId) {
    try {
      // Try to get Project model
      let ProjectModel;
      try {
        ProjectModel = mongoose.model("Project");
      } catch (e) {
        return {
          valid: true, // Assume valid if can"t check
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
   * Map plan names to call features (from original code)
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
   * Check if call can be made (from original code)
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
   * Record call usage (from original code)
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
   * End call (decrement concurrent count) (from original code)
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
   * Reset monthly usage (from original code)
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