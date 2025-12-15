// saaschat-server/lib/livekit-helpers.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/livekit-config');

class LiveKitHelpers {
  constructor(db) {
    this.db = db; // MongoDB database instance
    
    // Initialize Supabase client
    this.supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
  }

  /**
   * UPDATE: Update LiveKit features in Supabase
   * Called from dashboard when admin changes features
   */
  async updateSupabaseFeatures(agent_id, plan, features) {
    try {
      console.log(`ðŸ“¦ Updating Supabase for agent: ${agent_id}`);
      
      // Validate inputs
      if (!agent_id || !features) {
        throw new Error('agent_id and features are required');
      }

      // Prepare update data
      const updateData = {
        agent_id: agent_id,
        plan: plan || 'custom',
        features: features,
        updated_at: new Date().toISOString()
      };

      // Check if record exists
      const { data: existing, error: fetchError } = await this.supabase
        .from('agent_features')
        .select('*')
        .eq('agent_id', agent_id)
        .single();

      let result;
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // Record doesn't exist, INSERT
        updateData.created_at = new Date().toISOString();
        const { data, error } = await this.supabase
          .from('agent_features')
          .insert([updateData])
          .select();
        
        if (error) throw error;
        result = data;
        console.log(`âœ… Inserted new Supabase record for ${agent_id}`);
      } else {
        // Record exists, UPDATE
        const { data, error } = await this.supabase
          .from('agent_features')
          .update(updateData)
          .eq('agent_id', agent_id)
          .select();
        
        if (error) throw error;
        result = data;
        console.log(`âœ… Updated existing Supabase record for ${agent_id}`);
      }

      return {
        success: true,
        data: result,
        action: existing ? 'updated' : 'inserted'
      };

    } catch (error) {
      console.error('âŒ Supabase update error:', error);
      return {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  }

  /**
   * FETCH: Get LiveKit features from Supabase for a specific agent
   */
  async fetchFromSupabase(agentId) {
    try {
      // First try agent_features table
      const { data, error } = await this.supabase
        .from('agent_features')
        .select('plan, features')
        .eq('agent_id', agentId)
        .single();

      if (!error && data) {
        return {
          success: true,
          plan: data.plan,
          features: data.features,
          source: 'supabase_agent_features'
        };
      }

      // Fallback: Check user_workspaces table
      const { data: fallbackData, error: fallbackError } = await this.supabase
        .from('user_workspaces')
        .select('plan_type, livekit_plan')
        .eq('tiledesk_user_id', agentId)
        .single();

      if (!fallbackError && fallbackData) {
        return {
          success: true,
          plan: fallbackData.plan_type,
          features: fallbackData.livekit_plan || config.defaultFeatures,
          source: 'user_workspaces'
        };
      }

      // Default fallback
      return {
        success: false,
        plan: 'starter',
        features: config.defaultFeatures,
        source: 'default'
      };

    } catch (error) {
      console.error('âŒ Error fetching from Supabase:', error.message);
      return {
        success: false,
        plan: 'starter',
        features: config.defaultFeatures,
        source: 'error',
        error: error.message
      };
    }
  }

  /**
   * SYNC: Store LiveKit features in Tiledesk MongoDB
   */
  async syncToTiledesk(agentId, plan, features) {
    try {
      console.log(`ðŸ”„ Starting sync for agent: ${agentId}`);
      console.log(`ðŸ“¦ Plan: ${plan}, Features:`, JSON.stringify(features, null, 2));
      
      // METHOD 1: Try this.db (passed from route initialization)
      let db = this.db;
      let usingTempConnection = false;
      let tempClient = null;
      
      // METHOD 2: If not available, create direct connection
      if (!db) {
        console.log('â„¹ï¸ this.db not available, creating direct MongoDB connection');
        const { MongoClient } = require('mongodb');
        
        // Use your actual MongoDB URL from .env
        const url = process.env.MONGODB_URI || 
                   process.env.MONGO_URL || 
                   'mongodb://mongo:27017/tiledesk';
        
        console.log(`ðŸ”— Connecting to MongoDB: ${url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
        
        tempClient = await MongoClient.connect(url, { 
          useUnifiedTopology: true,
          useNewUrlParser: true 
        });
        
        // Determine database name from URL or use default
        const dbName = url.includes('tiledesk') ? 'tiledesk' : 
                      url.includes('chat21') ? 'chat21' : 'tiledesk';
        
        db = tempClient.db(dbName);
        usingTempConnection = true;
        console.log(`âœ… Connected to database: ${dbName}`);
      } else {
        console.log('âœ… Using existing db connection from this.db');
      }
      
      // Verify we can access the collection
      const usersCollection = db.collection('users');
      console.log(`ðŸ“Š Accessing collection: users`);
      
      const updateData = {
        'livekit_features': features,
        'livekit_plan': plan,
        'livekit_synced_at': new Date(),
        'updatedAt': new Date()
      };
      
      console.log(`ðŸ“ Update data for ${agentId}:`, JSON.stringify(updateData, null, 2));
      
      const result = await usersCollection.updateOne(
        { _id: agentId },
        { $set: updateData },
        { upsert: true }
      );

      // Clean up temp connection if we created one
      if (usingTempConnection && tempClient) {
        await tempClient.close();
        console.log('ðŸ”Œ Closed temporary MongoDB connection');
      }

      console.log(`âœ… Successfully synced to MongoDB for ${agentId}`);
      console.log(`ðŸ“Š Update result: matched=${result.matchedCount}, modified=${result.modifiedCount}, upserted=${result.upsertedCount}`);
      
      return {
        success: true,
        modified: result.modifiedCount > 0,
        upserted: result.upsertedCount > 0,
        matched: result.matchedCount
      };
    } catch (error) {
      console.error('âŒ Error syncing to Tiledesk:');
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * GET: Retrieve LiveKit features from Tiledesk MongoDB
   */
  async getFromTiledesk(agentId) {
    try {
      const usersCollection = this.db.collection('users');
      const user = await usersCollection.findOne(
        { _id: agentId },
        { 
          projection: { 
            livekit_features: 1, 
            livekit_plan: 1, 
            livekit_synced_at: 1 
          } 
        }
      );

      if (user && user.livekit_features) {
        return {
          success: true,
          plan: user.livekit_plan || 'starter',
          features: user.livekit_features,
          synced_at: user.livekit_synced_at,
          source: 'tiledesk'
        };
      }

      return {
        success: false,
        plan: 'starter',
        features: config.defaultFeatures,
        source: 'not_found'
      };
    } catch (error) {
      console.error('âŒ Error fetching from Tiledesk:', error.message);
      return {
        success: false,
        plan: 'starter',
        features: config.defaultFeatures,
        source: 'error',
        error: error.message
      };
    }
  }

  /**
   * VALIDATE: Ensure features have proper structure
   */
  validateFeatures(features) {
    const defaultStructure = {
      audio: true,
      video: true,
      screen_share: false,
      image_share: false,
      file_share: false,
      max_participants: 2,
      max_call_minutes: 0
    };

    // Ensure all required fields exist
    const validated = { ...defaultStructure, ...features };
    
    // Ensure boolean fields are actually boolean
    ['audio', 'video', 'screen_share', 'image_share', 'file_share'].forEach(field => {
      if (typeof validated[field] !== 'boolean') {
        validated[field] = Boolean(validated[field]);
      }
    });

    // Ensure numeric fields are numbers
    validated.max_participants = Number(validated.max_participants) || 2;
    validated.max_call_minutes = Number(validated.max_call_minutes) || 0;

    return validated;
  }
}

module.exports = LiveKitHelpers;
