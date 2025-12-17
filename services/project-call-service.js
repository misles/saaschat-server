// D:\tiledesk\saaschat-server\services\project-call-service.js
const LiveKitHelpers = require('../lib/livekit-helpers');

class ProjectCallService {
  constructor(db) {
    this.db = db;
    this.livekitHelpers = new LiveKitHelpers(db);
    this.ProjectCallFeatures = db.models.ProjectCallFeatures;
  }

  /**
   * Get project call features with Supabase plan checks
   */
  async getProjectCallFeatures(projectId, checkSupabase = true) {
    try {
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
      }
      
      // If checking Supabase, verify project has valid subscription
      if (checkSupabase) {
        const supabaseCheck = await this.checkProjectSubscription(projectId);
        if (!supabaseCheck.valid) {
          // Disable calls if no valid subscription
          projectFeatures.settings.enabled = false;
        }
      }
      
      return {
        success: true,
        data: projectFeatures,
        message: 'Project call features retrieved'
      };
      
    } catch (error) {
      console.error('Error getting project call features:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if project has valid Supabase subscription for calls
   */
  async checkProjectSubscription(projectId) {
    try {
      // Get project from MongoDB
      const Project = this.db.models.Project;
      const project = await Project.findOne({ _id: projectId });
      
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
      console.error('Error checking project subscription:', error);
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
        max_concurrent_calls: 1000, // from project profile
        monthly_call_limit: -1
      }
    };
    
    return plans[planName.toLowerCase()] || plans['free'];
  }

  /**
   * Sync project features to all agents in project
   */
  async syncToAgents(projectId, features) {
    try {
      // Get all agents in project
      const ProjectUser = this.db.models.ProjectUser;
      const agents = await ProjectUser.find({ 
        project_id: projectId,
        role: { $in: ['agent', 'admin', 'owner'] }
      });
      
      const results = {
        total_agents: agents.length,
        synced: 0,
        failed: 0,
        details: []
      };
      
      // Sync to each agent's Supabase record
      for (const agent of agents) {
        try {
          const agentId = agent.user_id || agent._id;
          
          // Get current agent features from Supabase
          const supabaseData = await this.livekitHelpers.fetchFromSupabase(agentId);
          
          // Merge project features with agent's existing features
          const mergedFeatures = {
            ...supabaseData.features,
            ...features.settings,
            // Override with project settings
            enabled: features.settings.enabled,
            audio_calls: features.settings.audio_calls,
            video_calls: features.settings.video_calls,
            screen_sharing: features.settings.screen_sharing,
            call_recording: features.settings.call_recording
          };
          
          // Update Supabase
          await this.livekitHelpers.updateSupabaseFeatures(
            agentId,
            supabaseData.plan || 'custom',
            mergedFeatures
          );
          
          // Update Tiledesk cache
          await this.livekitHelpers.syncToTiledesk(
            agentId,
            supabaseData.plan || 'custom',
            mergedFeatures
          );
          
          results.synced++;
          results.details.push({
            agent_id: agentId,
            status: 'synced',
            features: Object.keys(mergedFeatures)
          });
          
        } catch (agentError) {
          results.failed++;
          results.details.push({
            agent_id: agent.user_id || agent._id,
            status: 'failed',
            error: agentError.message
          });
        }
      }
      
      // Update project sync timestamp
      await this.ProjectCallFeatures.updateOne(
        { project_id: projectId },
        { $set: { last_synced_at: new Date() } }
      );
      
      return {
        success: true,
        project_id: projectId,
        results: results,
        message: `Synced features to ${results.synced} agents`
      };
      
    } catch (error) {
      console.error('Error syncing to agents:', error);
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
      const projectFeatures = await this.getProjectCallFeatures(projectId);
      
      if (!projectFeatures.success || !projectFeatures.data.settings.enabled) {
        return {
          allowed: false,
          reason: 'Calls disabled for project'
        };
      }
      
      // Check specific feature
      const featureKey = callType === 'video' ? 'video_calls' : 'audio_calls';
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
          reason: 'Concurrent call limit reached'
        };
      }
      
      // Check monthly limit (if not unlimited)
      if (projectFeatures.data.settings.monthly_call_limit > 0 &&
          projectFeatures.data.usage.calls_this_month >= 
          projectFeatures.data.settings.monthly_call_limit) {
        return {
          allowed: false,
          reason: 'Monthly call limit reached'
        };
      }
      
      return {
        allowed: true,
        project_features: projectFeatures.data
      };
      
    } catch (error) {
      console.error('Error checking call permission:', error);
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
      console.error('Error recording call usage:', error);
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
      console.error('Error ending call:', error);
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
      console.error('Error resetting usage:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = ProjectCallService;