// services/project-call-service.js - CORRECTED VERSION
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
    console.log("PROJECT-CALL-SERVICE: Updates:", updates);
    
    if (!this.ProjectCallFeatures) {
      return {
        success: false,
        error: "Model not available"
      };
    }
    
    try {
      // Get current document first
      const current = await this.ProjectCallFeatures.findOne({ project_id: projectId });
      
      // Start with update timestamp
      let updateObj = { updated_at: new Date() };
      
      // Handle settings merge
      if (updates.settings) {
        if (current && current.settings) {
          // Get current settings (handle Mongoose document)
          const currentSettings = current.settings.toObject ? current.settings.toObject() : current.settings;
          updateObj.settings = { ...currentSettings, ...updates.settings };
        } else {
          updateObj.settings = updates.settings;
        }
      }
      
      // Handle top-level fields (not in settings)
      for (const key in updates) {
        if (key !== "settings" && key !== "_id" && key !== "__v") {
          updateObj[key] = updates[key];
        }
      }
      
      console.log("PROJECT-CALL-SERVICE: Final update object:", updateObj);
      
      // Handle the update
      const result = await this.ProjectCallFeatures.findOneAndUpdate(
        { project_id: projectId },
        { $set: updateObj },
        { new: true, upsert: true }
      );
      
      console.log("PROJECT-CALL-SERVICE: ✅ Update successful");
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
}

module.exports = ProjectCallService;