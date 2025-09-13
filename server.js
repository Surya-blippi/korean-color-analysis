// server.js - Complete WhatsApp Korean Color Analysis Bot with Aisensy
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

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Initialize services
const geminiAnalyzer = new GeminiColorAnalyzer();
const conversationManager = new ConversationManager();
const paymentManager = new PaymentManager();

// Aisensy API Configuration
const AISENSY_API_KEY = process.env.AISENSY_API_KEY;

// Aisensy API helper functions
class AisensyAPI {
  constructor() {
    this.apiKey = AISENSY_API_KEY;
    this.baseUrl = 'https://backend.aisensy.com/campaign/t1/api/v2';
    
    if (!this.apiKey) {
      console.error('Aisensy API key not found. Please set AISENSY_API_KEY in your environment variables.');
    }
  }

  async sendMessage(to, messageData) {
    try {
      // Clean phone number format
      const cleanNumber = to.replace(/[^\d]/g, '');
      
      const payload = {
        apiKey: this.apiKey,
        campaignName: 'korean_color_analysis',
        destination: cleanNumber,
        userName: 'ColorBot',
        templateParams: [],
        source: 'whatsapp-bot',
        media: messageData.media || {},
        attributes: {
          name: 'User'
        },
        message: messageData.text || messageData.message || ''
      };

      console.log('Sending to Aisensy:', {
        ...payload,
        apiKey: '[HIDDEN]'
      });

      const response = await axios.post(`${this.baseUrl}/send`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-AiSensy-API-KEY': this.apiKey
        },
        timeout: 10000 // 10 second timeout
      });

      console.log('Aisensy response:', response.data);
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
    // Since Aisensy might not support interactive buttons, send as numbered options
    const buttonText = buttons.map((btn, index) => 
      `${index + 1}. ${btn.text}`
    ).join('\n');
    
    const fullMessage = `${bodyText}\n\n${buttonText}\n\nReply with the number of your choice.`;
    return this.sendTextMessage(to, fullMessage);
  }

  async sendListMessage(to, bodyText, buttonText, sections) {
    // Convert list to text format
    let listText = `${bodyText}\n\n`;
    
    let optionNumber = 1;
    sections.forEach(section => {
      if (section.title) {
        listText += `**${section.title}**\n`;
      }
      section.rows.forEach((row) => {
        listText += `${optionNumber}. ${row.title}\n`;
        if (row.description) {
          listText += `   ${row.description}\n`;
        }
        optionNumber++;
      });
      listText += '\n';
    });
    
    listText += `Reply with the number of your choice.`;
    return this.sendTextMessage(to, listText);
  }

  async downloadMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 30000 // 30 second timeout for media download
      });

      return {
        data: response.data,
        contentType: response.headers['content-type'] || 'image/jpeg'
      };
    } catch (error) {
      console.error('Error downloading media:', error);
      throw error;
    }
  }
}

// Initialize Aisensy API
const aisensyAPI = new AisensyAPI();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    conversations: conversationManager.getActiveConversationsCount(),
    platform: 'Aisensy'
  });
});

// Aisensy webhook verification
app.get('/webhook/aisensy', (req, res) => {
  console.log('Webhook verification request');
  res.status(200).send('Webhook verified');
});

// Main Aisensy webhook handler
app.post('/webhook/aisensy', async (req, res) => {
  try {
    const body = req.body;
    console.log('Aisensy webhook received:', JSON.stringify(body, null, 2));

    // Handle different Aisensy webhook formats
    if (body.type === 'message' || body.event === 'message' || body.messages) {
      // Extract message data based on Aisensy's format
      let message, contact;
      
      if (body.messages && Array.isArray(body.messages)) {
        // If messages is an array
        const msgData = body.messages[0];
        message = {
          id: msgData.id || msgData.messageId || Date.now().toString(),
          from: msgData.from || msgData.sender || msgData.phone,
          timestamp: msgData.timestamp || Date.now(),
          type: msgData.type || msgData.messageType || 'text',
          text: msgData.type === 'text' ? { body: msgData.text || msgData.message } : null,
          image: msgData.type === 'image' ? { 
            url: msgData.mediaUrl || msgData.media_url,
            id: msgData.mediaId 
          } : null
        };
        
        contact = {
          profile: { name: msgData.senderName || msgData.name || 'User' }
        };
      } else {
        // Single message format
        message = {
          id: body.id || body.messageId || Date.now().toString(),
          from: body.from || body.sender || body.phone,
          timestamp: body.timestamp || Date.now(),
          type: body.type || body.messageType || 'text',
          text: (body.type === 'text' || body.messageType === 'text') ? 
                { body: body.text || body.message } : null,
          image: (body.type === 'image' || body.messageType === 'image') ? { 
            url: body.mediaUrl || body.media_url,
            id: body.mediaId 
          } : null
        };
        
        contact = {
          profile: { name: body.senderName || body.name || 'User' }
        };
      }

      await handleMessage(message, contact);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Aisensy webhook error:', error);
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
    if (message.type === 'text' && message.text) {
      await handleTextMessage(phoneNumber, message.text.body, conversation);
    } else if (message.type === 'image' && message.image) {
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

// Text message handler
async function handleTextMessage(phoneNumber, text, conversation) {
  const lowerText = text.toLowerCase().trim();

  switch (conversation.state) {
    case 'initial':
    case 'welcome':
      if (lowerText.includes('start') || lowerText.includes('begin') || 
          lowerText.includes('hi') || lowerText.includes('hello')) {
        await sendWelcomeMessage(phoneNumber);
        conversation.state = 'guide_shown';
      } else {
        await sendWelcomeMessage(phoneNumber);
        conversation.state = 'guide_shown';
      }
      break;

    case 'guide_shown':
      if (lowerText.includes('ready') || lowerText.includes('yes') || 
          lowerText.includes('continue') || lowerText === '1') {
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
      if (lowerText.includes('pdf') || lowerText.includes('guide') || 
          lowerText.includes('buy') || lowerText === '1') {
        await handlePDFRequest(phoneNumber, conversation);
      } else if (lowerText.includes('new') || lowerText.includes('another') || 
                 lowerText.includes('again') || lowerText === '2') {
        await resetAnalysis(phoneNumber, conversation);
      } else if (lowerText.includes('share') || lowerText === '3') {
        await shareResults(phoneNumber, conversation);
      } else {
        await sendResultsOptions(phoneNumber);
      }
      break;

    case 'payment_pending':
      if (lowerText.includes('paid') || lowerText.includes('payment') || 
          lowerText.includes('done')) {
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

// Image message handler
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

    // Download the image
    let mediaData;
    if (image.url) {
      mediaData = await aisensyAPI.downloadMedia(image.url);
    } else {
      throw new Error('No image URL provided');
    }
    
    // Create a temporary file
    const tempFileName = `temp_${phoneNumber}_${Date.now()}.jpg`;
    const tempFilePath = path.join('uploads', tempFileName);
    
    fs.writeFileSync(tempFilePath, mediaData.data);

    // Analyze with Gemini
    const analysisResult = await geminiAnalyzer.analyzeFromBuffer(
      mediaData.data, 
      mediaData.contentType
    );

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

// Interactive message handler
async function handleInteractiveMessage(phoneNumber, interactive, conversation) {
  const buttonId = interactive.button_reply?.id || interactive.list_reply?.id;

  switch (buttonId) {
    case 'start_analysis':
    case '1':
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

// Message templates
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

  try {
    // Create payment link
    const paymentLink = await paymentManager.createPaymentLink(phoneNumber, conversation.analysis);
    
    await aisensyAPI.sendTextMessage(phoneNumber, pdfText);
    await aisensyAPI.sendTextMessage(
      phoneNumber, 
      `💳 **Pay securely here:** ${paymentLink}\n\nAfter payment, I'll send your complete PDF guide instantly! ✨`
    );

    conversation.state = 'payment_pending';
    conversation.paymentLink = paymentLink;
  } catch (error) {
    console.error('Payment link creation error:', error);
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "Sorry, there was an issue creating your payment link. Please try again in a moment."
    );
  }
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

  try {
    // Check payment status logic here
    const paymentData = paymentManager.getPaymentByPhoneNumber(phoneNumber);
    
    if (paymentData && paymentData.status === 'completed') {
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
  } catch (error) {
    console.error('Payment status check error:', error);
    await aisensyAPI.sendTextMessage(
      phoneNumber,
      "There was an error checking your payment. Please contact support. 🙏"
    );
  }
}

// PDF Generation placeholder
async function generatePDF(analysis, phoneNumber) {
  // This would implement actual PDF generation
  const fileName = `color-analysis-${phoneNumber}-${Date.now()}.pdf`;
  const pdfUrl = `${process.env.BASE_URL}/pdfs/${fileName}`;
  
  // TODO: Implement actual PDF generation logic
  
  return pdfUrl;
}

// Payment routes
app.get('/pay/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  try {
    const paymentData = paymentManager.pendingPayments.get(orderId);
    
    if (!paymentData) {
      return res.status(404).send('Payment not found');
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Korean Color Analysis - Payment</title>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            margin: 0;
        }
        .container {
            background: white;
            border-radius: 24px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
            padding: 40px;
            max-width: 500px;
            width: 100%;
            text-align: center;
        }
        .header {
            background: linear-gradient(135deg, #ec4899, #f43f5e);
            color: white;
            padding: 30px;
            border-radius: 16px;
            margin-bottom: 30px;
        }
        h1 { font-size: 28px; margin-bottom: 8px; }
        .amount { font-size: 48px; font-weight: bold; color: #1f2937; margin-bottom: 8px; }
        .pay-btn {
            background: linear-gradient(135deg, #ec4899, #f43f5e);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 16px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Complete Style Guide</h1>
            <p>Your personalized color analysis</p>
        </div>
        <div class="amount">₹699</div>
        <button class="pay-btn" onclick="makePayment()" id="payBtn">
            💳 Pay Securely with Razorpay
        </button>
    </div>

    <script>
        function makePayment() {
            const options = {
                key: '${process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID}',
                amount: ${paymentData.amount},
                currency: 'INR',
                name: 'Korean Color Analysis',
                description: 'Complete Style Guide PDF',
                order_id: '${orderId}',
                handler: function (response) {
                    alert('Payment successful! You will receive your PDF shortly.');
                    window.close();
                }
            };
            const rzp = new Razorpay(options);
            rzp.open();
        }
    </script>
</body>
</html>`;

    res.send(html);
    
  } catch (error) {
    console.error('Payment page error:', error);
    res.status(500).send('Error loading payment page');
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 WhatsApp Korean Color Analysis Bot (Aisensy) running on port ${PORT}`);
  console.log(`📱 Webhook URL: ${process.env.BASE_URL}/webhook/aisensy`);
  console.log(`🔑 API Key configured: ${AISENSY_API_KEY ? 'Yes' : 'No'}`);
});

module.exports = app;