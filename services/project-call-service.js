const mongoose = require('mongoose');
const LiveKitHelpers = require('../lib/livekit-helpers');

class ProjectCallService {
  constructor(db) {
    console.log('PROJECT-CALL-SERVICE: Constructor called');
    
    // Get the model - it should already be loaded in app.js
    try {
      this.ProjectCallFeatures = mongoose.model('ProjectCallFeatures');
      console.log('PROJECT-CALL-SERVICE: ✅ Model found');
    } catch (error) {
      console.log('PROJECT-CALL-SERVICE: ⚠️ Model not found:', error.message);
      this.ProjectCallFeatures = null;
    }
    
    // Initialize LiveKit helpers if available
    try {
      this.livekitHelpers = new LiveKitHelpers(db);
    } catch (error) {
      console.log('PROJECT-CALL-SERVICE: LiveKitHelpers not available:', error.message);
      this.livekitHelpers = null;
    }
  }

  /**
   * Get project call features with Supabase plan checks
   */
  async getProjectCallFeatures(projectId, checkSupabase = true) {
    try {
      console.log('PROJECT-CALL-SERVICE: Getting features for:', projectId);
      
      // If model not available, return error
      if (!this.ProjectCallFeatures) {
        return {
          success: false,
          error: 'Database model not available',
          message: 'ProjectCallFeatures model not initialized'
        };
      }
      
      // Get project features from MongoDB
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
            video_quality: 'medium',
            audio_quality: 'medium',
            show_call_button: true,
            require_precall_test: false
          }
        });
        await projectFeatures.save();
        console.log('PROJECT-CALL-SERVICE: ✅ Default features created for project:', projectId);
      }
      
      // If checking Supabase, verify project has valid subscription
      if (checkSupabase && this.livekitHelpers) {
        try {
          const supabaseCheck = await this.checkProjectSubscription(projectId);
          if (!supabaseCheck.valid) {
            // Disable calls if no valid subscription
            projectFeatures.settings.enabled = false;
            await projectFeatures.save();
          }
        } catch (supabaseError) {
          console.warn('PROJECT-CALL-SERVICE: Supabase check failed:', supabaseError.message);
        }
      }
      
      return {
        success: true,
        data: projectFeatures,
        message: 'Project call features retrieved'
      };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error getting project call features:', error.message);
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
      console.log('PROJECT-CALL-SERVICE: Updating features for:', projectId);
      
      if (!this.ProjectCallFeatures) {
        return {
          success: false,
          error: 'Database model not available'
        };
      }
      
      // Prepare update data
      const updateData = { updated_at: new Date() };
      
      // Handle nested settings update
      if (updates.settings) {
        updateData.$set = { 'settings': updates.settings };
      } else {
        updateData.$set = updates;
      }
      
      const result = await this.ProjectCallFeatures.findOneAndUpdate(
        { project_id: projectId },
        updateData,
        { new: true, upsert: true, runValidators: true }
      );
      
      console.log('PROJECT-CALL-SERVICE: ✅ Update successful for project:', projectId);
      
      return {
        success: true,
        data: result,
        message: 'Project call features updated'
      };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Update error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if call can be made (usage limits)
   */
  async canMakeCall(projectId, callType = 'audio') {
    try {
      const result = await this.getProjectCallFeatures(projectId, false);
      
      if (!result.success || !result.data) {
        return {
          allowed: false,
          reason: 'Failed to get project features'
        };
      }
      
      const projectFeatures = result.data;
      const settings = projectFeatures.settings;
      const usage = projectFeatures.usage;
      
      // Check if enabled
      if (!settings.enabled) {
        return {
          allowed: false,
          reason: 'Calls disabled for project'
        };
      }
      
      // Check specific feature
      if (callType === 'video' && !settings.video_calls) {
        return {
          allowed: false,
          reason: 'Video calls disabled'
        };
      }
      
      if (callType === 'screen_share' && !settings.screen_sharing) {
        return {
          allowed: false,
          reason: 'Screen sharing disabled'
        };
      }
      
      // Check concurrent calls limit
      if (usage.concurrent_calls_now >= settings.max_concurrent_calls) {
        return {
          allowed: false,
          reason: 'Concurrent call limit reached'
        };
      }
      
      // Check monthly limit (if not unlimited)
      if (settings.monthly_call_limit > 0 && 
          usage.calls_this_month >= settings.monthly_call_limit) {
        return {
          allowed: false,
          reason: 'Monthly call limit reached'
        };
      }
      
      return {
        allowed: true,
        project_features: projectFeatures
      };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error checking call permission:', error.message);
      return {
        allowed: false,
        reason: 'Error checking permissions'
      };
    }
  }

  /**
   * Record call usage
   */
  async recordCallUsage(projectId, durationSeconds = 0) {
    try {
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $inc: {
            'usage.calls_this_month': 1,
            'usage.total_call_minutes': Math.ceil(durationSeconds / 60),
            'usage.concurrent_calls_now': 1
          },
          $set: { updated_at: new Date() }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error recording call usage:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * End call (decrement concurrent count)
   */
  async endCall(projectId) {
    try {
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $inc: { 'usage.concurrent_calls_now': -1 },
          $set: { updated_at: new Date() }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error ending call:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset monthly usage
   */
  async resetMonthlyUsage(projectId) {
    try {
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        {
          $set: {
            'usage.calls_this_month': 0,
            'usage.total_call_minutes': 0,
            'usage.last_reset_date': new Date(),
            updated_at: new Date()
          }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error resetting usage:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if project has valid Supabase subscription for calls
   */
  async checkProjectSubscription(projectId) {
    try {
      // Try to get project model
      let ProjectModel;
      try {
        ProjectModel = mongoose.model('Project');
      } catch (error) {
        console.warn('PROJECT-CALL-SERVICE: Project model not available');
        return {
          valid: true, // Assume valid if can't check
          reason: 'Could not check subscription',
          can_enable: true
        };
      }
      
      const project = await ProjectModel.findOne({ _id: projectId });
      
      if (!project) {
        return {
          valid: false,
          reason: 'Project not found',
          can_enable: false
        };
      }
      
      // Check project profile for plan info
      const planName = project.profile?.name || 'free';
      const maxAgents = project.profile?.agents || 0;
      
      // Determine call features based on plan
      const planFeatures = this.getPlanFeatures(planName);
      
      return {
        valid: true,
        plan: planName,
        max_agents: maxAgents,
        features: planFeatures,
        can_enable: planFeatures.allows_calls
      };
      
    } catch (error) {
      console.error('PROJECT-CALL-SERVICE: ❌ Error checking project subscription:', error.message);
      return {
        valid: false,
        reason: 'Error checking subscription',
        can_enable: false
      };
    }
  }

  /**
   * Map plan names to call features
   */
  getPlanFeatures(planName) {
    const plans = {
      'free': {
        allows_calls: false,
        audio_calls: false,
        video_calls: false,
        max_concurrent_calls: 0,
        monthly_call_limit: 0
      },
      'basic': {
        allows_calls: true,
        audio_calls: true,
        video_calls: false,
        max_concurrent_calls: 1,
        monthly_call_limit: 100
      },
      'pro': {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        max_concurrent_calls: 2,
        monthly_call_limit: 500
      },
      'enterprise': {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        call_recording: true,
        max_concurrent_calls: 10,
        monthly_call_limit: -1 // unlimited
      },
      'custom': {
        allows_calls: true,
        audio_calls: true,
        video_calls: true,
        screen_sharing: true,
        call_recording: true,
        max_concurrent_calls: 1000,
        monthly_call_limit: -1
      }
    };
    
    return plans[planName.toLowerCase()] || plans['free'];
  }
}

module.exports = ProjectCallService;