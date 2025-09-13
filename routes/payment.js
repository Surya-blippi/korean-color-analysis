// routes/payment.js - Payment page handler
const express = require('express');
const router = express.Router();

// Payment page route
router.get('/pay/:orderId', async (req, res) => {
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #fdf2f8 0%, #fce7f3 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
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
        
        .icon {
            width: 60px;
            height: 60px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 16px;
            margin: 0 auto 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        
        h1 {
            font-size: 28px;
            margin-bottom: 8px;
        }
        
        .subtitle {
            opacity: 0.9;
            font-size: 16px;
        }
        
        .season-info {
            background: linear-gradient(135deg, #fdf2f8, #fce7f3);
            padding: 20px;
            border-radius: 16px;
            margin-bottom: 30px;
            border: 2px solid #f3e8ff;
        }
        
        .season-title {
            font-size: 20px;
            font-weight: bold;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .season-desc {
            color: #6b7280;
            font-size: 14px;
        }
        
        .features {
            text-align: left;
            margin-bottom: 30px;
        }
        
        .feature {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            font-size: 14px;
            color: #374151;
        }
        
        .feature::before {
            content: "✨";
            margin-right: 12px;
            font-size: 16px;
        }
        
        .amount {
            font-size: 48px;
            font-weight: bold;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .amount-desc {
            color: #6b7280;
            margin-bottom: 30px;
        }
        
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
            margin-bottom: 16px;
            transition: transform 0.2s;
        }
        
        .pay-btn:hover {
            transform: translateY(-2px);
        }
        
        .pay-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .security {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #6b7280;
            font-size: 12px;
            margin-top: 16px;
        }
        
        .security::before {
            content: "🔒";
            margin-right: 8px;
        }
        
        .whatsapp-link {
            margin-top: 20px;
            color: #ec4899;
            text-decoration: none;
            font-size: 14px;
        }
        
        .whatsapp-link:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 24px;
            }
            
            .header {
                padding: 24px;
            }
            
            .amount {
                font-size: 36px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="icon">🎨</div>
            <h1>Complete Style Guide</h1>
            <p class="subtitle">Your personalized color analysis</p>
        </div>
        
        <div class="season-info">
            <div class="season-title">You're a ${paymentData.analysis.personal_profile.season}!</div>
            <div class="season-desc">${paymentData.analysis.personal_profile.summary}</div>
        </div>
        
        <div class="features">
            <div class="feature">15-page detailed style guide</div>
            <div class="feature">Complete color palettes with hex codes</div>
            <div class="feature">Makeup brand recommendations</div>
            <div class="feature">Hair color suggestions with examples</div>
            <div class="feature">Fashion styling tips</div>
            <div class="feature">Printable wallet-sized color card</div>
        </div>
        
        <div class="amount">₹699</div>
        <p class="amount-desc">One-time payment • Instant delivery</p>
        
        <button class="pay-btn" onclick="makePayment()" id="payBtn">
            💳 Pay Securely with Razorpay
        </button>
        
        <div class="security">Secured by Razorpay • 100% Safe</div>
        
        <a href="https://wa.me/${process.env.WHATSAPP_PHONE_NUMBER}" class="whatsapp-link">
            ← Return to WhatsApp chat
        </a>
    </div>

    <script>
        function makePayment() {
            const btn = document.getElementById('payBtn');
            btn.disabled = true;
            btn.textContent = 'Processing...';
            
            const options = {
                key: '${process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID}',
                amount: ${paymentData.amount},
                currency: 'INR',
                name: 'Korean Color Analysis',
                description: 'Complete Style Guide PDF',
                order_id: '${orderId}',
                handler: function (response) {
                    // Verify payment
                    fetch('/api/verify-payment', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        }),
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            window.location.href = '/payment-success?order_id=' + response.razorpay_order_id;
                        } else {
                            alert('Payment verification failed. Please contact support.');
                            btn.disabled = false;
                            btn.textContent = '💳 Pay Securely with Razorpay';
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        alert('An error occurred. Please try again.');
                        btn.disabled = false;
                        btn.textContent = '💳 Pay Securely with Razorpay';
                    });
                },
                prefill: {
                    name: 'Valued Customer',
                },
                theme: {
                    color: '#ec4899'
                },
                modal: {
                    ondismiss: function() {
                        btn.disabled = false;
                        btn.textContent = '💳 Pay Securely with Razorpay';
                    }
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

// Payment verification API
router.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const verificationResult = await paymentManager.verifyPayment(
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature
    );
    
    if (verificationResult.success) {
      // Send success message to WhatsApp
      const paymentData = verificationResult.paymentData;
      if (paymentData && paymentData.phoneNumber) {
        await WhatsAppAPI.sendTextMessage(
          paymentData.phoneNumber,
          "🎉 Payment successful! Your complete style guide is being prepared. You'll receive it within the next few minutes!"
        );
        
        // Update conversation state
        const conversation = conversationManager.getConversation(paymentData.phoneNumber);
        if (conversation) {
          conversation.state = 'payment_completed';
          conversationManager.saveConversation(paymentData.phoneNumber, conversation);
        }
      }
      
      res.json({ success: true });
    } else {
      res.json({ success: false, error: verificationResult.error });
    }
    
  } catch (error) {
    console.error('Payment verification error:', error);
    res.json({ success: false, error: 'Verification failed' });
  }
});

// Payment success page
router.get('/payment-success', (req, res) => {
  const orderId = req.query.order_id;
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Successful - Korean Color Analysis</title>
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
        
        .success-icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, #10b981, #059669);
            border-radius: 50%;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 40px;
            color: white;
        }
        
        h1 {
            color: #1f2937;
            margin-bottom: 16px;
            font-size: 28px;
        }
        
        p {
            color: #6b7280;
            margin-bottom: 24px;
            line-height: 1.6;
        }
        
        .whatsapp-btn {
            background: linear-gradient(135deg, #25d366, #128c7e);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin-bottom: 16px;
            transition: transform 0.2s;
        }
        
        .whatsapp-btn:hover {
            transform: translateY(-2px);
            text-decoration: none;
            color: white;
        }
        
        .order-id {
            background: #f3f4f6;
            padding: 16px;
            border-radius: 12px;
            margin-top: 24px;
            font-size: 14px;
            color: #6b7280;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>Payment Successful!</h1>
        <p>Thank you for your purchase! Your complete Korean Color Analysis style guide is being prepared and will be delivered to your WhatsApp chat within the next few minutes.</p>
        
        <a href="https://wa.me/${process.env.WHATSAPP_PHONE_NUMBER}" class="whatsapp-btn">
            📱 Return to WhatsApp
        </a>
        
        <div class="order-id">
            <strong>Order ID:</strong> ${orderId}
        </div>
        
        <p style="font-size: 12px; margin-top: 24px;">
            If you don't receive your PDF within 5 minutes, please message us on WhatsApp.
        </p>
    </div>
</body>
</html>`;

  res.send(html);
});

module.exports = router;

// =================================================================
// .env.example - Environment Variables Template
// =================================================================
/*
Create a .env file with these variables:

# WhatsApp Business API Configuration
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_PHONE_NUMBER=+1234567890
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token

# Gemini AI Configuration  
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key

# Razorpay Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
NEXT_PUBLIC_RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Server Configuration
PORT=3000
BASE_URL=https://your-domain.com
NODE_ENV=production

# Optional: Database URLs (if using external databases)
# MONGODB_URI=mongodb://localhost:27017/colorbot
# REDIS_URL=redis://localhost:6379
*/

// =================================================================
// DEPLOYMENT INSTRUCTIONS
// =================================================================
/*
WHATSAPP KOREAN COLOR ANALYSIS BOT - COMPLETE SETUP GUIDE

1. PREREQUISITES
   - Node.js 18+ installed
   - WhatsApp Business Account
   - Razorpay Account
   - Gemini AI API key
   - Domain with SSL certificate

2. INSTALLATION STEPS

   Step 1: Clone and Setup Project
   ```bash
   git clone <your-repo>
   cd whatsapp-korean-color-bot
   npm install
   ```

   Step 2: Environment Configuration
   - Copy .env.example to .env
   - Fill in all required API keys and tokens

   Step 3: WhatsApp Business API Setup
   - Go to Facebook Developers Console
   - Create a WhatsApp Business App
   - Get your access token and phone number ID
   - Set webhook URL: https://your-domain.com/webhook
   - Set verify token in your .env file

   Step 4: Razorpay Setup
   - Create Razorpay account
   - Get API keys from dashboard
   - Set up webhooks: https://your-domain.com/api/razorpay/webhook

   Step 5: Gemini AI Setup
   - Go to Google AI Studio
   - Create API key
   - Enable Gemini 1.5 Flash API

3. LOCAL DEVELOPMENT
   ```bash
   npm run dev
   # Server runs on http://localhost:3000
   # Use ngrok for webhook testing:
   ngrok http 3000
   ```

4. DEPLOYMENT OPTIONS

   Option A: Railway (Recommended)
   - Connect your GitHub repo
   - Add environment variables
   - Auto-deploys on push

   Option B: Heroku
   ```bash
   heroku create your-app-name
   heroku config:set WHATSAPP_ACCESS_TOKEN=your_token
   # ... set all env vars
   git push heroku main
   ```

   Option C: VPS/DigitalOcean
   ```bash
   # Install PM2 for process management
   npm install -g pm2
   pm2 start server.js --name color-bot
   pm2 startup
   pm2 save
   ```

5. WEBHOOK VERIFICATION
   - Test webhook: GET https://your-domain.com/webhook
   - Verify WhatsApp integration works
   - Test payment flow end-to-end

6. MONITORING & MAINTENANCE
   - Check logs: pm2 logs color-bot
   - Monitor conversations: GET /health endpoint
   - Backup data regularly
   - Update dependencies monthly

7. CUSTOMIZATION
   - Modify conversation flows in server.js
   - Update payment amounts in PaymentManager.js
   - Customize messages and branding
   - Add analytics tracking

8. TROUBLESHOOTING
   - Check webhook verification in Meta Developer Console
   - Verify SSL certificate is valid
   - Test API keys individually
   - Monitor server logs for errors

9. SCALING CONSIDERATIONS
   - Use Redis for conversation storage at scale
   - Implement proper database for payments
   - Add rate limiting and DDoS protection
   - Set up CDN for static assets

10. SECURITY BEST PRACTICES
    - Never expose API keys in client code
    - Validate all webhook signatures
    - Implement proper error handling
    - Regular security updates

For support, check the logs and ensure all environment variables are correctly set.
*/