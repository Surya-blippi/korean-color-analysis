// utils/ConversationManager.js
const fs = require('fs');
const path = require('path');

class ConversationManager {
  constructor() {
    this.conversations = new Map();
    this.dataDir = path.join(process.cwd(), 'data');
    this.conversationsFile = path.join(this.dataDir, 'conversations.json');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Load existing conversations
    this.loadConversations();
    
    // Auto-save every 5 minutes
    setInterval(() => {
      this.saveAllConversations();
    }, 5 * 60 * 1000);
    
    // Cleanup old conversations daily
    setInterval(() => {
      this.cleanupOldConversations();
    }, 24 * 60 * 60 * 1000);
  }

  createConversation(phoneNumber, userInfo = {}) {
    const conversation = {
      phoneNumber,
      state: 'initial',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      messageCount: 0,
      userInfo: {
        name: userInfo.name || 'User',
        ...userInfo
      },
      analysis: null,
      paymentInfo: null,
      pdfGenerated: false,
      sessionData: {}
    };

    this.conversations.set(phoneNumber, conversation);
    return conversation;
  }

  getConversation(phoneNumber) {
    return this.conversations.get(phoneNumber);
  }

  saveConversation(phoneNumber, conversation) {
    conversation.lastActive = new Date().toISOString();
    conversation.messageCount = (conversation.messageCount || 0) + 1;
    this.conversations.set(phoneNumber, conversation);
  }

  updateConversationState(phoneNumber, state, data = {}) {
    const conversation = this.getConversation(phoneNumber);
    if (conversation) {
      conversation.state = state;
      conversation.lastActive = new Date().toISOString();
      
      // Merge additional data
      Object.assign(conversation.sessionData, data);
      
      this.conversations.set(phoneNumber, conversation);
      return conversation;
    }
    return null;
  }

  setAnalysisResult(phoneNumber, analysis) {
    const conversation = this.getConversation(phoneNumber);
    if (conversation) {
      conversation.analysis = analysis;
      conversation.analyzedAt = new Date().toISOString();
      this.conversations.set(phoneNumber, conversation);
      return true;
    }
    return false;
  }

  setPaymentInfo(phoneNumber, paymentInfo) {
    const conversation = this.getConversation(phoneNumber);
    if (conversation) {
      conversation.paymentInfo = {
        ...conversation.paymentInfo,
        ...paymentInfo,
        updatedAt: new Date().toISOString()
      };
      this.conversations.set(phoneNumber, conversation);
      return true;
    }
    return false;
  }

  markPDFGenerated(phoneNumber, pdfUrl) {
    const conversation = this.getConversation(phoneNumber);
    if (conversation) {
      conversation.pdfGenerated = true;
      conversation.pdfUrl = pdfUrl;
      conversation.pdfGeneratedAt = new Date().toISOString();
      this.conversations.set(phoneNumber, conversation);
      return true;
    }
    return false;
  }

  getActiveConversationsCount() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    let activeCount = 0;
    for (const conversation of this.conversations.values()) {
      const lastActive = new Date(conversation.lastActive);
      if (lastActive > yesterday) {
        activeCount++;
      }
    }
    
    return activeCount;
  }

  getConversationStats() {
    const stats = {
      total: this.conversations.size,
      active: this.getActiveConversationsCount(),
      completed: 0,
      paidCustomers: 0,
      averageMessages: 0,
      stateDistribution: {}
    };

    let totalMessages = 0;

    for (const conversation of this.conversations.values()) {
      totalMessages += conversation.messageCount || 0;
      
      if (conversation.analysis) {
        stats.completed++;
      }
      
      if (conversation.pdfGenerated) {
        stats.paidCustomers++;
      }
      
      // State distribution
      const state = conversation.state || 'unknown';
      stats.stateDistribution[state] = (stats.stateDistribution[state] || 0) + 1;
    }

    if (this.conversations.size > 0) {
      stats.averageMessages = Math.round(totalMessages / this.conversations.size);
    }

    return stats;
  }

  // User engagement tracking
  trackUserAction(phoneNumber, action, data = {}) {
    const conversation = this.getConversation(phoneNumber);
    if (conversation) {
      if (!conversation.userActions) {
        conversation.userActions = [];
      }
      
      conversation.userActions.push({
        action,
        timestamp: new Date().toISOString(),
        data
      });
      
      this.conversations.set(phoneNumber, conversation);
    }
  }

  // Analytics methods
  getUserJourney(phoneNumber) {
    const conversation = this.getConversation(phoneNumber);
    if (!conversation) return null;

    return {
      phoneNumber,
      createdAt: conversation.createdAt,
      lastActive: conversation.lastActive,
      currentState: conversation.state,
      messageCount: conversation.messageCount || 0,
      hasAnalysis: !!conversation.analysis,
      hasPaid: !!conversation.pdfGenerated,
      actions: conversation.userActions || [],
      timeToAnalysis: conversation.analyzedAt ? 
        new Date(conversation.analyzedAt) - new Date(conversation.createdAt) : null,
      timeToPurchase: conversation.pdfGeneratedAt ?
        new Date(conversation.pdfGeneratedAt) - new Date(conversation.createdAt) : null
    };
  }

  // Export user data (for GDPR compliance)
  exportUserData(phoneNumber) {
    const conversation = this.getConversation(phoneNumber);
    if (!conversation) return null;

    return {
      phoneNumber,
      userInfo: conversation.userInfo,
      createdAt: conversation.createdAt,
      lastActive: conversation.lastActive,
      messageCount: conversation.messageCount,
      analysis: conversation.analysis,
      userActions: conversation.userActions || []
    };
  }

  // Delete user data (for GDPR compliance)
  deleteUserData(phoneNumber) {
    const deleted = this.conversations.delete(phoneNumber);
    if (deleted) {
      this.saveAllConversations();
    }
    return deleted;
  }

  // File operations
  loadConversations() {
    try {
      if (fs.existsSync(this.conversationsFile)) {
        const data = fs.readFileSync(this.conversationsFile, 'utf8');
        const conversationsArray = JSON.parse(data);
        
        this.conversations = new Map(
          conversationsArray.map(conv => [conv.phoneNumber, conv])
        );
        
        console.log(`✅ Loaded ${this.conversations.size} conversations from disk`);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      this.conversations = new Map();
    }
  }

  saveAllConversations() {
    try {
      const conversationsArray = Array.from(this.conversations.values());
      fs.writeFileSync(
        this.conversationsFile, 
        JSON.stringify(conversationsArray, null, 2), 
        'utf8'
      );
      
      console.log(`💾 Saved ${conversationsArray.length} conversations to disk`);
    } catch (error) {
      console.error('Error saving conversations:', error);
    }
  }

  // Cleanup old conversations (older than 30 days)
  cleanupOldConversations() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    let cleanedCount = 0;
    
    for (const [phoneNumber, conversation] of this.conversations.entries()) {
      const lastActive = new Date(conversation.lastActive);
      
      // Keep conversations that are recent, have analysis, or are paid customers
      if (lastActive < thirtyDaysAgo && 
          !conversation.analysis && 
          !conversation.pdfGenerated) {
        this.conversations.delete(phoneNumber);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old conversations`);
      this.saveAllConversations();
    }
  }

  // Backup conversations
  createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.dataDir, `conversations-backup-${timestamp}.json`);
    
    try {
      const conversationsArray = Array.from(this.conversations.values());
      fs.writeFileSync(
        backupFile, 
        JSON.stringify(conversationsArray, null, 2), 
        'utf8'
      );
      
      console.log(`📦 Created backup: ${backupFile}`);
      return backupFile;
    } catch (error) {
      console.error('Error creating backup:', error);
      return null;
    }
  }

  // Find conversations by criteria
  findConversations(criteria = {}) {
    const results = [];
    
    for (const conversation of this.conversations.values()) {
      let matches = true;
      
      if (criteria.state && conversation.state !== criteria.state) {
        matches = false;
      }
      
      if (criteria.hasAnalysis !== undefined && 
          !!conversation.analysis !== criteria.hasAnalysis) {
        matches = false;
      }
      
      if (criteria.hasPaid !== undefined && 
          !!conversation.pdfGenerated !== criteria.hasPaid) {
        matches = false;
      }
      
      if (criteria.minMessages && 
          (conversation.messageCount || 0) < criteria.minMessages) {
        matches = false;
      }
      
      if (criteria.activeSince) {
        const activeSince = new Date(criteria.activeSince);
        const lastActive = new Date(conversation.lastActive);
        if (lastActive < activeSince) {
          matches = false;
        }
      }
      
      if (matches) {
        results.push(conversation);
      }
    }
    
    return results;
  }

  // Get conversion metrics
  getConversionMetrics() {
    const total = this.conversations.size;
    if (total === 0) return null;

    const completed = this.findConversations({ hasAnalysis: true }).length;
    const paid = this.findConversations({ hasPaid: true }).length;
    
    return {
      totalUsers: total,
      completedAnalysis: completed,
      purchasedPDF: paid,
      analysisConversionRate: ((completed / total) * 100).toFixed(2) + '%',
      paymentConversionRate: completed > 0 ? 
        ((paid / completed) * 100).toFixed(2) + '%' : '0%',
      overallConversionRate: ((paid / total) * 100).toFixed(2) + '%'
    };
  }
}

module.exports = ConversationManager;