// server.js - Modified for Aisensy Integration
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GeminiColorAnalyzer = require('./utils/GeminiColorAnalyzer');
const ConversationManager = require('./utils/ConversationManager');
const PaymentManager = require('./utils/PaymentManager');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Initialize services
const geminiAnalyzer = new GeminiColorAnalyzer();
const conversationManager = new ConversationManager();
const paymentManager = new PaymentManager();

// REPLACE THIS SECTION: Aisensy API Configuration (instead of WhatsApp API)
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_INSTANCE_ID = process.env.AISENSY_INSTANCE_ID;

// REPLACE: Aisensy API helper functions (replaces WhatsAppAPI class)
class AisensyAPI {
  constructor() {
    this.apiKey = AISENSY_API_KEY;
    this.instanceId = AISENSY_INSTANCE_ID;
    this.baseUrl = 'https://backend.aisensy.com/campaign/t1/api/v2';
  }

  async sendMessage(to, messageData) {
    try {
      const payload = {
        apiKey: this.apiKey,
        campaignName: 'korean_color_analysis',
        destination: to.replace('+', '').replace(/\s/g, ''), // Clean phone number
        userName: 'ColorBot',
        templateParams: [],
        source: 'whatsapp-bot',
        media: messageData.media || {},
        attributes: {
          name: 'User'
        },
        message: messageData.message || messageData.text || ''
      };

      console.log('Sending to Aisensy:', payload);

      const response = await axios.post(`${this.baseUrl}/send`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-AiSensy-API-KEY': this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      console.error('Aisensy API error:', error.response?.data || error.message);
      throw error;
    }
  }

  async sendTextMessage(to, text) {
    return this.sendMessage(to, { text: text });
  }

  async sendImageMessage(to, imageUrl, caption = "") {
    return this.sendMessage(to, {
      text: caption,
      media: {
        type: 'image',
        url: imageUrl
      }
    });
  }

  async sendButtonMessage(to, bodyText, buttons) {
    // Aisensy might not support interactive buttons the same way
    // Send as text with options for now
    const buttonText = buttons.map((btn, index) => 
      `${index + 1}. ${btn.text}`
    ).join('\n');
    
    const fullMessage = `${bodyText}\n\n${buttonText}\n\nReply with the number of your choice.`;
    return this.sendTextMessage(to, fullMessage);
  }

  async sendListMessage(to, bodyText, buttonText, sections) {
    // Convert list to text format
    let listText = `${bodyText}\n\n`;
    
    sections.forEach(section => {
      if (section.title) {
        listText += `**${section.title}**\n`;
      }
      section.rows.forEach((row, index) => {
        listText += `${index + 1}. ${row.title}\n`;
        if (row.description) {
          listText += `   ${row.description}\n`;
        }
      });
      listText += '\n';
    });
    
    listText += `Reply with the number of your choice.`;
    return this.sendTextMessage(to, listText);
  }

  // Aisensy media download (if supported)
  async downloadMedia(mediaId) {
    try {
      // This would depend on Aisensy's specific media handling
      // You may need to check their documentation for media download endpoints
      const response = await axios.get(`${this.baseUrl}/media/${mediaId}`, {
        headers: {
          'X-AiSensy-API-KEY': this.apiKey
        },
        responseType: 'arraybuffer'
      });

      return {
        data: response.data,
        contentType: response.headers['content-type']
      };
    } catch (error) {
      console.error('Error downloading media from Aisensy:', error);
      throw error;
    }
  }
}

// Initialize Aisensy API
const aisensyAPI = new AisensyAPI();

// REPLACE: Aisensy webhook endpoint (replaces Meta webhook verification)
app.get('/webhook/aisensy', (req, res) => {
  // Aisensy might have different verification process
  // Check their documentation for webhook verification
  res.status(200).send('Webhook verified');
});

// REPLACE: Main webhook handler for Aisensy (replaces Meta webhook handler)
app.post('/webhook/aisensy', async (req, res) => {
  try {
    const body = req.body;
    console.log('Aisensy webhook received:', JSON.stringify(body, null, 2));

    // Aisensy webhook format (you may need to adjust based on their actual format)
    if (body.type === 'message' || body.event === 'message') {
      const message = {
        id: body.id || body.messageId,
        from: body.from || body.sender,
        timestamp: body.timestamp || Date.now(),
        type: body.messageType || body.type,
        text: body.messageType === 'text' ? { body: body.text || body.message } : null,
        image: body.messageType === 'image' ? { 
          id: body.mediaId,
          url: body.mediaUrl 
        } : null,
        interactive: body.messageType === 'interactive' ? {
          button_reply: body.buttonReply ? { id: body.buttonReply } : null,
          list_reply: body.listReply ? { id: body.listReply } : null
        } : null
      };

      const contact = {
        profile: { 
          name: body.senderName || body.userName || 'User' 
        }
      };

      await handleMessage(message, contact);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Aisensy webhook error:', error);
    res.sendStatus(500);
  }
});

// Message handler (KEEP THIS - just update API calls)
async function handleMessage(message, contact) {
  const phoneNumber = message.from;
  const messageId = message.id;
  const timestamp = message.timestamp;

  console.log(`📱 Message from ${phoneNumber}:`, message);

  try {
    // Get or create conversation state
    let conversation = conversationManager.getConversation(phoneNumber);
    
    if (!conversation) {
      conversation = conversationManager.createConversation(phoneNumber, {
        name: contact?.profile?.name || 'Friend',
        lastActive: timestamp
      });
    }

    // Update last active
    conversation.lastActive = timestamp;

    // Handle different message types
    if (message.type === 'text') {
      await handleTextMessage(phoneNumber, message.text.body, conversation);
    } else if (message.type === 'image') {
      await handleImageMessage(phoneNumber, message.image, conversation);
    } else if (message.type === 'interactive') {
      await handleInteractiveMessage(phoneNumber, message.interactive, conversation);
    } else {
      await aisensyAPI.sendTextMessage(
        phoneNumber, 
        "I can help you with Korean color analysis! Please send me a clear selfie or type 'start' to begin. ✨"
      );
    }

    // Save conversation state
    conversationManager.saveConversation(phoneNumber, conversation);

  } catch (error) {
    console.error('Error handling message:', error);
    await aisensyAPI.sendTextMessage(
      phoneNumber, 
      "Sorry, I encountered an error. Please try again or contact support. 🙏"
    );
  }
}

// Text message handler (UPDATE API CALLS)
async function handleTextMessage(phoneNumber, text, conversation) {
  const lowerText = text.toLowerCase().trim();

  switch (conversation.state) {
    case 'initial':
    case 'welcome':
      if (lowerText.includes('start') || lowerText.includes('begin') || lowerText.includes('hi') || lowerText.includes('hello')) {
        await sendWelcomeMessage(phoneNumber);
        conversation.state = 'guide_shown';
      } else {
        await sendWelcomeMessage(phoneNumber);
        conversation.state = 'guide_shown';
      }
      break;

    case 'guide_shown':
      if (lowerText.includes('ready') || lowerText.includes('yes') || lowerText.includes('continue')) {
        await sendPhotoInstructions(phoneNumber);
        conversation.state = 'waiting_for_photo';
      } else {
        await sendGuideMessage(phoneNumber);
      }
      break;

    case 'waiting_for_photo':
      await aisensyAPI.sendTextMessage(
        phoneNumber,
        "I'm waiting for your beautiful selfie! 📸 Please take a clear photo following the guidelines I shared earlier."
      );
      break;

    case 'analyzing':
      await aisensyAPI.sendTextMessage(
        phoneNumber,
        "I'm still analyzing your photo... This usually takes 30-60 seconds. Please wait! ✨"
      );
      break;

    case 'results_shown':
      if (lowerText.includes('pdf') || lowerText.includes('guide') || lowerText.includes('buy')) {
        await handlePDFRequest(phoneNumber, conversation);
      } else if (lowerText.includes('new') || lowerText.includes('another') || lowerText.includes('again')) {
        await resetAnalysis(phoneNumber, conversation);
      } else {
        await sendResultsOptions(phoneNumber);
      }
      break;

    case 'payment_pending':
      if (lowerText.includes('paid') || lowerText.includes('payment') || lowerText.includes('done')) {
        await checkPaymentStatus(phoneNumber, conversation);
      } else {
        await aisensyAPI.sendTextMessage(
          phoneNumber,
          "Please complete your payment to receive the complete style guide. If you've already paid, type 'paid' to check status. 💳"
        );
      }
      break;

    default:
      await sendWelcomeMessage(phoneNumber);
      conversation.state = 'guide_shown';
  }
}

// Image message handler (UPDATE MEDIA HANDLING)
async function handleImageMessage(phoneNumber, image, conversation) {
  if (conversation.state !== 'waiting_for_photo') {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "Thanks for the photo! But I'm not ready to analyze it yet. Please type 'start' to begin the process properly. ✨"
    );
    return;
  }

  try {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "📸 Got your beautiful photo! Let me analyze your colors... This will take 30-60 seconds. ✨"
    );

    conversation.state = 'analyzing';

    // Download the image from Aisensy
    let mediaData;
    if (image.url) {
      // If Aisensy provides direct URL
      const response = await axios.get(image.url, { responseType: 'arraybuffer' });
      mediaData = {
        data: response.data,
        contentType: response.headers['content-type'] || 'image/jpeg'
      };
    } else if (image.id) {
      // If Aisensy uses media ID system
      mediaData = await aisensyAPI.downloadMedia(image.id);
    }
    
    // Create a temporary file
    const tempFileName = `temp_${phoneNumber}_${Date.now()}.jpg`;
    const tempFilePath = path.join('uploads', tempFileName);
    
    fs.writeFileSync(tempFilePath, mediaData.data);

    // Create a File-like object for the analyzer
    const fileBuffer = fs.readFileSync(tempFilePath);
    const mockFile = {
      type: mediaData.contentType || 'image/jpeg',
      size: fileBuffer.length,
      arrayBuffer: () => Promise.resolve(fileBuffer.buffer),
      stream: () => new ReadableStream({
        start(controller) {
          controller.enqueue(fileBuffer);
          controller.close();
        }
      })
    };

    // Analyze with Gemini
    const analysisResult = await geminiAnalyzer.analyzeColors(mockFile);

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    if (analysisResult.success) {
      conversation.analysis = analysisResult.analysis;
      conversation.state = 'results_shown';
      await sendAnalysisResults(phoneNumber, analysisResult.analysis);
    } else {
      conversation.state = 'waiting_for_photo';
      await aisensyAPI.sendTextMessage(
        phoneNumber,
        `Sorry, I couldn't analyze your photo: ${analysisResult.error}\n\nPlease try with a different photo - make sure it's well-lit and shows your face clearly! 📸`
      );
    }

  } catch (error) {
    console.error('Image processing error:', error);
    conversation.state = 'waiting_for_photo';
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "Sorry, there was an issue processing your photo. Please try sending it again! 📸"
    );
  }
}

// Interactive message handler (UPDATE FOR SIMPLE TEXT RESPONSES)
async function handleInteractiveMessage(phoneNumber, interactive, conversation) {
  // Since Aisensy might not support complex interactive messages,
  // we'll handle this as text responses
  const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;

  switch (buttonId) {
    case 'start_analysis':
    case '1': // If user replied with number
      await sendPhotoInstructions(phoneNumber);
      conversation.state = 'waiting_for_photo';
      break;
    
    case 'get_pdf':
    case '2':
      await handlePDFRequest(phoneNumber, conversation);
      break;
    
    case 'new_analysis':
    case '3':
      await resetAnalysis(phoneNumber, conversation);
      break;
    
    case 'share_results':
    case '4':
      await shareResults(phoneNumber, conversation);
      break;

    default:
      await aisensyAPI.sendTextMessage(phoneNumber, "I didn't understand that option. Please try again! 🤔");
  }
}

// MESSAGE TEMPLATES (UPDATE ALL aisensyAPI CALLS)
async function sendWelcomeMessage(phoneNumber) {
  const welcomeText = `✨ Welcome to Korean Color Analysis!

I'm your AI color expert, ready to discover your perfect palette! 

🎨 I'll analyze your photo using advanced AI to determine:
• Your personal season (Spring, Summer, Autumn, Winter)
• Your best colors and shades
• Makeup & style recommendations
• Colors to avoid

Ready to discover your true colors? 💖

Reply with:
1. Let's Start! ✨`;

  await aisensyAPI.sendTextMessage(phoneNumber, welcomeText);
}

async function sendGuideMessage(phoneNumber) {
  const guideText = `📸 For the best results, please follow these tips:

✅ DO THIS:
• Use natural light (near a window)
• Plain, light background
• Face the camera directly
• Remove glasses/hat
• Minimal or no makeup
• Keep hair away from face

❌ AVOID:
• Artificial lighting
• Colored backgrounds
• Heavy makeup
• Shadows on face
• Blurry photos

Ready to take your perfect selfie?

Reply with:
1. I'm Ready! 📸`;

  await aisensyAPI.sendTextMessage(phoneNumber, guideText);
}

async function sendPhotoInstructions(phoneNumber) {
  const instructions = `📷 Perfect! Now please send me your selfie.

Remember:
• Good lighting is key!
• Face the camera
• Plain background
• Clear, unblurry photo

I'll analyze your colors as soon as you send it! ✨`;

  await aisensyAPI.sendTextMessage(phoneNumber, instructions);
}

async function sendAnalysisResults(phoneNumber, analysis) {
  // Main result message
  const resultText = `🎉 Analysis Complete!

🌟 **You're a ${analysis.personal_profile.season}!**

${analysis.personal_profile.summary}

**Your undertone:** ${analysis.personal_profile.undertone}`;

  await aisensyAPI.sendTextMessage(phoneNumber, resultText);

  // Key colors
  if (analysis.color_palettes.key_colors?.length) {
    const keyColors = analysis.color_palettes.key_colors
      .slice(0, 6)
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await aisensyAPI.sendTextMessage(phoneNumber, `🎨 **Your Key Colors:**\n• ${keyColors}`);
  }

  // Neutrals
  if (analysis.color_palettes.neutrals?.length) {
    const neutrals = analysis.color_palettes.neutrals
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await aisensyAPI.sendTextMessage(phoneNumber, `🤍 **Your Best Neutrals:**\n• ${neutrals}`);
  }

  // Quick recommendations
  if (analysis.recommendations) {
    const quickRecs = `💄 **Quick Recommendations:**

**Makeup Style:** ${analysis.recommendations.makeup?.vibe}
**Best Lipstick:** ${analysis.recommendations.makeup?.lipstick}
**Hair Colors:** ${analysis.recommendations.hair_colors?.slice(0, 3).join(', ')}
**Jewelry:** ${analysis.recommendations.style?.jewelry}`;

    await aisensyAPI.sendTextMessage(phoneNumber, quickRecs);
  }

  // Colors to avoid
  if (analysis.colors_to_avoid?.length) {
    const avoidColors = analysis.colors_to_avoid
      .slice(0, 4)
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await aisensyAPI.sendTextMessage(phoneNumber, `⚠️ **Colors to Use Carefully:**\n• ${avoidColors}`);
  }

  // Options for next steps
  await sendResultsOptions(phoneNumber);
}

async function sendResultsOptions(phoneNumber) {
  const optionsText = `What would you like to do next? 💖

1. 📄 Get Complete Style Guide (15-page PDF with detailed recommendations - ₹699)
2. 🔄 Analyze Another Photo (Start fresh with a new selfie)
3. 📱 Share My Results (Share your color season with friends)

Reply with the number of your choice.`;

  await aisensyAPI.sendTextMessage(phoneNumber, optionsText);
}

async function handlePDFRequest(phoneNumber, conversation) {
  if (!conversation.analysis) {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "Please complete your color analysis first before purchasing the PDF guide! Type 'start' to begin. ✨"
    );
    return;
  }

  const pdfText = `📚 **Complete Style Guide - ₹699**

Get your personalized 15-page PDF including:
• Complete color palettes with hex codes
• Specific makeup brand recommendations
• Hair color suggestions with examples
• Fashion styling tips
• Printable wallet-sized color card
• Shopping guides for different budgets

This one-time payment gives you everything you need to transform your style! 💫`;

  // Create payment link
  const paymentLink = await paymentManager.createPaymentLink(phoneNumber, conversation.analysis);
  
  await aisensyAPI.sendTextMessage(phoneNumber, pdfText);
  await aisensyAPI.sendTextMessage(
    phoneNumber, 
    `💳 **Pay securely here:** ${paymentLink}\n\nAfter payment, I'll send your complete PDF guide instantly! ✨`
  );

  conversation.state = 'payment_pending';
  conversation.paymentLink = paymentLink;
}

async function resetAnalysis(phoneNumber, conversation) {
  conversation.state = 'guide_shown';
  conversation.analysis = null;
  conversation.paymentLink = null;
  
  await aisensyAPI.sendTextMessage(
    phoneNumber,
    "Let's start fresh! 🌟 Ready for your new color analysis?"
  );
  
  await sendGuideMessage(phoneNumber);
}

async function shareResults(phoneNumber, conversation) {
  if (!conversation.analysis) {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "Please complete your analysis first! Type 'start' to begin. ✨"
    );
    return;
  }

  const shareText = `🎨 I just discovered I'm a ${conversation.analysis.personal_profile.season}! 

✨ Want to find your perfect colors too? 
💬 Message this number for your free Korean Color Analysis!

#ColorAnalysis #KoreanColorAnalysis #PersonalColors`;

  await aisensyAPI.sendTextMessage(
    phoneNumber,
    `Here's a message you can share with friends: 📱\n\n${shareText}`
  );
}

async function checkPaymentStatus(phoneNumber, conversation) {
  await aisensyAPI.sendTextMessage(
    phoneNumber,
    "Checking your payment status... Please wait a moment! 🔄"
  );

  const paymentVerified = await paymentManager.verifyPayment(conversation.paymentLink);
  
  if (paymentVerified) {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "🎉 Payment confirmed! Generating your complete style guide... This will take about 30 seconds."
    );

    // Generate and send PDF
    const pdfUrl = await generatePDF(conversation.analysis, phoneNumber);
    
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      `📚 Your complete Korean Color Analysis guide is ready! 

Download it here: ${pdfUrl}

This link will be valid for 7 days. Save it to your device!

Thank you for choosing us! If you love your results, please share with friends! 💖`
    );

    conversation.state = 'completed';
    conversation.pdfGenerated = true;
  } else {
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "I couldn't verify your payment yet. Please try again in a few minutes or contact support if you've already paid. 🙏"
    );
  }
}

// PDF Generation (keep this the same)
async function generatePDF(analysis, phoneNumber) {
  const fileName = `color-analysis-${phoneNumber}-${Date.now()}.pdf`;
  const pdfUrl = `${process.env.BASE_URL}/pdfs/${fileName}`;
  
  // Generate PDF logic here...
  
  return pdfUrl;
}

// Health check endpoint (keep this)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    conversations: conversationManager.getActiveConversationsCount(),
    platform: 'Aisensy'
  });
});

// Include payment routes
const paymentRoutes = require('./routes/payment');
app.use('/', paymentRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 WhatsApp Korean Color Analysis Bot (Aisensy) running on port ${PORT}`);
  console.log(`📱 Webhook URL: ${process.env.BASE_URL}/webhook/aisensy`);
});

module.exports = app;