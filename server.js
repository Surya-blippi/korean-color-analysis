// server.js - Main WhatsApp Bot Server
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

// WhatsApp API configuration
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// WhatsApp API helper functions
class WhatsAppAPI {
  static async sendMessage(to, message) {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: to,
          ...message
        },
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  static async sendTextMessage(to, text) {
    return this.sendMessage(to, {
      type: "text",
      text: { body: text }
    });
  }

  static async sendImageMessage(to, imageUrl, caption = "") {
    return this.sendMessage(to, {
      type: "image",
      image: {
        link: imageUrl,
        caption: caption
      }
    });
  }

  static async sendButtonMessage(to, bodyText, buttons) {
    return this.sendMessage(to, {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.map((btn, index) => ({
            type: "reply",
            reply: {
              id: btn.id,
              title: btn.text
            }
          }))
        }
      }
    });
  }

  static async sendListMessage(to, bodyText, buttonText, sections) {
    return this.sendMessage(to, {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections
        }
      }
    });
  }

  static async downloadMedia(mediaId) {
    try {
      // Get media URL
      const mediaResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${mediaId}`,
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          },
        }
      );

      const mediaUrl = mediaResponse.data.url;

      // Download media content
      const contentResponse = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        },
        responseType: 'arraybuffer'
      });

      return {
        data: contentResponse.data,
        contentType: contentResponse.headers['content-type']
      };
    } catch (error) {
      console.error('Error downloading media:', error);
      throw error;
    }
  }
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.error('Webhook verification failed');
    res.sendStatus(403);
  }
});

// Main webhook handler
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        if (!value.messages) continue;

        for (const message of value.messages) {
          await handleMessage(message, value.contacts?.[0]);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// Message handler
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
      await WhatsAppAPI.sendTextMessage(
        phoneNumber, 
        "I can help you with Korean color analysis! Please send me a clear selfie or type 'start' to begin. ✨"
      );
    }

    // Save conversation state
    conversationManager.saveConversation(phoneNumber, conversation);

  } catch (error) {
    console.error('Error handling message:', error);
    await WhatsAppAPI.sendTextMessage(
      phoneNumber, 
      "Sorry, I encountered an error. Please try again or contact support. 🙏"
    );
  }
}

// Text message handler
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
      await WhatsAppAPI.sendTextMessage(
        phoneNumber,
        "I'm waiting for your beautiful selfie! 📸 Please take a clear photo following the guidelines I shared earlier."
      );
      break;

    case 'analyzing':
      await WhatsAppAPI.sendTextMessage(
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
        await WhatsAppAPI.sendTextMessage(
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

// Image message handler
async function handleImageMessage(phoneNumber, image, conversation) {
  if (conversation.state !== 'waiting_for_photo') {
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "Thanks for the photo! But I'm not ready to analyze it yet. Please type 'start' to begin the process properly. ✨"
    );
    return;
  }

  try {
    // Download and process the image
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "📸 Got your beautiful photo! Let me analyze your colors... This will take 30-60 seconds. ✨"
    );

    conversation.state = 'analyzing';

    // Download the image
    const mediaData = await WhatsAppAPI.downloadMedia(image.id);
    
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
      await WhatsAppAPI.sendTextMessage(
        phoneNumber,
        `Sorry, I couldn't analyze your photo: ${analysisResult.error}\n\nPlease try with a different photo - make sure it's well-lit and shows your face clearly! 📸`
      );
    }

  } catch (error) {
    console.error('Image processing error:', error);
    conversation.state = 'waiting_for_photo';
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "Sorry, there was an issue processing your photo. Please try sending it again! 📸"
    );
  }
}

// Interactive message handler
async function handleInteractiveMessage(phoneNumber, interactive, conversation) {
  const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;

  switch (buttonId) {
    case 'start_analysis':
      await sendPhotoInstructions(phoneNumber);
      conversation.state = 'waiting_for_photo';
      break;
    
    case 'get_pdf':
      await handlePDFRequest(phoneNumber, conversation);
      break;
    
    case 'new_analysis':
      await resetAnalysis(phoneNumber, conversation);
      break;
    
    case 'share_results':
      await shareResults(phoneNumber, conversation);
      break;

    default:
      await WhatsAppAPI.sendTextMessage(phoneNumber, "I didn't understand that option. Please try again! 🤔");
  }
}

// Message templates
async function sendWelcomeMessage(phoneNumber) {
  const welcomeText = `✨ Welcome to Korean Color Analysis!

I'm your AI color expert, ready to discover your perfect palette! 

🎨 I'll analyze your photo using advanced AI to determine:
• Your personal season (Spring, Summer, Autumn, Winter)
• Your best colors and shades
• Makeup & style recommendations
• Colors to avoid

Ready to discover your true colors? 💖`;

  await WhatsAppAPI.sendButtonMessage(phoneNumber, welcomeText, [
    { id: 'start_analysis', text: 'Let\'s Start! ✨' }
  ]);
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

Ready to take your perfect selfie?`;

  await WhatsAppAPI.sendButtonMessage(phoneNumber, guideText, [
    { id: 'start_analysis', text: 'I\'m Ready! 📸' }
  ]);
}

async function sendPhotoInstructions(phoneNumber) {
  const instructions = `📷 Perfect! Now please send me your selfie.

Remember:
• Good lighting is key!
• Face the camera
• Plain background
• Clear, unblurry photo

I'll analyze your colors as soon as you send it! ✨`;

  await WhatsAppAPI.sendTextMessage(phoneNumber, instructions);
}

async function sendAnalysisResults(phoneNumber, analysis) {
  // Main result message
  const resultText = `🎉 Analysis Complete!

🌟 **You're a ${analysis.personal_profile.season}!**

${analysis.personal_profile.summary}

**Your undertone:** ${analysis.personal_profile.undertone}`;

  await WhatsAppAPI.sendTextMessage(phoneNumber, resultText);

  // Key colors
  if (analysis.color_palettes.key_colors?.length) {
    const keyColors = analysis.color_palettes.key_colors
      .slice(0, 6)
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await WhatsAppAPI.sendTextMessage(phoneNumber, `🎨 **Your Key Colors:**\n• ${keyColors}`);
  }

  // Neutrals
  if (analysis.color_palettes.neutrals?.length) {
    const neutrals = analysis.color_palettes.neutrals
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await WhatsAppAPI.sendTextMessage(phoneNumber, `🤍 **Your Best Neutrals:**\n• ${neutrals}`);
  }

  // Quick recommendations
  if (analysis.recommendations) {
    const quickRecs = `💄 **Quick Recommendations:**

**Makeup Style:** ${analysis.recommendations.makeup?.vibe}
**Best Lipstick:** ${analysis.recommendations.makeup?.lipstick}
**Hair Colors:** ${analysis.recommendations.hair_colors?.slice(0, 3).join(', ')}
**Jewelry:** ${analysis.recommendations.style?.jewelry}`;

    await WhatsAppAPI.sendTextMessage(phoneNumber, quickRecs);
  }

  // Colors to avoid
  if (analysis.colors_to_avoid?.length) {
    const avoidColors = analysis.colors_to_avoid
      .slice(0, 4)
      .map(color => `${color.name} (${color.hex})`)
      .join('\n• ');
    
    await WhatsAppAPI.sendTextMessage(phoneNumber, `⚠️ **Colors to Use Carefully:**\n• ${avoidColors}`);
  }

  // Options for next steps
  await sendResultsOptions(phoneNumber);
}

async function sendResultsOptions(phoneNumber) {
  const optionsText = `What would you like to do next? 💖`;

  await WhatsAppAPI.sendListMessage(phoneNumber, optionsText, "Choose Option", [
    {
      title: "Next Steps",
      rows: [
        {
          id: "get_pdf",
          title: "📄 Get Complete Style Guide",
          description: "15-page PDF with detailed recommendations (₹699)"
        },
        {
          id: "new_analysis",
          title: "🔄 Analyze Another Photo",
          description: "Start fresh with a new selfie"
        },
        {
          id: "share_results",
          title: "📱 Share My Results",
          description: "Share your color season with friends"
        }
      ]
    }
  ]);
}

async function handlePDFRequest(phoneNumber, conversation) {
  if (!conversation.analysis) {
    await WhatsAppAPI.sendTextMessage(
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

  // Create payment link (you'll need to implement this based on your payment provider)
  const paymentLink = await paymentManager.createPaymentLink(phoneNumber, conversation.analysis);
  
  await WhatsAppAPI.sendTextMessage(phoneNumber, pdfText);
  await WhatsAppAPI.sendTextMessage(
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
  
  await WhatsAppAPI.sendTextMessage(
    phoneNumber,
    "Let's start fresh! 🌟 Ready for your new color analysis?"
  );
  
  await sendGuideMessage(phoneNumber);
}

async function shareResults(phoneNumber, conversation) {
  if (!conversation.analysis) {
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "Please complete your analysis first! Type 'start' to begin. ✨"
    );
    return;
  }

  const shareText = `🎨 I just discovered I'm a ${conversation.analysis.personal_profile.season}! 

✨ Want to find your perfect colors too? 
💬 Message this number for your free Korean Color Analysis!

#ColorAnalysis #KoreanColorAnalysis #PersonalColors`;

  await WhatsAppAPI.sendTextMessage(
    phoneNumber,
    `Here's a message you can share with friends: 📱\n\n${shareText}`
  );
}

async function checkPaymentStatus(phoneNumber, conversation) {
  // Implement payment verification logic here
  // This would integrate with your payment provider's webhook/API
  
  await WhatsAppAPI.sendTextMessage(
    phoneNumber,
    "Checking your payment status... Please wait a moment! 🔄"
  );

  // Mock payment check - replace with actual implementation
  const paymentVerified = await paymentManager.verifyPayment(conversation.paymentLink);
  
  if (paymentVerified) {
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "🎉 Payment confirmed! Generating your complete style guide... This will take about 30 seconds."
    );

    // Generate and send PDF
    const pdfUrl = await generatePDF(conversation.analysis, phoneNumber);
    
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      `📚 Your complete Korean Color Analysis guide is ready! 

Download it here: ${pdfUrl}

This link will be valid for 7 days. Save it to your device!

Thank you for choosing us! If you love your results, please share with friends! 💖`
    );

    conversation.state = 'completed';
    conversation.pdfGenerated = true;
  } else {
    await WhatsAppAPI.sendTextMessage(
      phoneNumber,
      "I couldn't verify your payment yet. Please try again in a few minutes or contact support if you've already paid. 🙏"
    );
  }
}

// PDF Generation (integrate with your existing PDF generation logic)
async function generatePDF(analysis, phoneNumber) {
  // Implement PDF generation logic here
  // This should create a detailed PDF based on the analysis
  // and return a download URL
  
  const fileName = `color-analysis-${phoneNumber}-${Date.now()}.pdf`;
  const pdfUrl = `${process.env.BASE_URL}/pdfs/${fileName}`;
  
  // Generate PDF logic here...
  
  return pdfUrl;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    conversations: conversationManager.getActiveConversationsCount()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 WhatsApp Korean Color Analysis Bot running on port ${PORT}`);
  console.log(`📱 Webhook URL: ${process.env.BASE_URL}/webhook`);
});

module.exports = app;