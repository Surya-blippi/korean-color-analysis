// utils/PaymentManager.js
const Razorpay = require('razorpay');
const crypto = require('crypto');

class PaymentManager {
  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    this.pendingPayments = new Map(); // In production, use a proper database
    this.baseUrl = process.env.BASE_URL || 'https://your-domain.com';
  }

  async createPaymentLink(phoneNumber, analysis) {
    try {
      const amount = 69900; // ₹699 in paise
      const currency = 'INR';
      
      // Create order with Razorpay
      const orderOptions = {
        amount: amount,
        currency: currency,
        receipt: `color_analysis_${phoneNumber}_${Date.now()}`,
        payment_capture: 1,
        notes: {
          phone_number: phoneNumber,
          service: 'Korean Color Analysis PDF',
          season: analysis.personal_profile.season,
          timestamp: new Date().toISOString(),
        },
      };

      const order = await this.razorpay.orders.create(orderOptions);

      // Store payment info
      const paymentData = {
        orderId: order.id,
        phoneNumber,
        amount,
        currency,
        status: 'created',
        createdAt: new Date().toISOString(),
        analysis
      };

      this.pendingPayments.set(order.id, paymentData);

      // Create payment link
      const paymentUrl = `${this.baseUrl}/pay/${order.id}`;
      
      return paymentUrl;

    } catch (error) {
      console.error('Error creating payment link:', error);
      throw new Error('Failed to create payment link. Please try again.');
    }
  }

  async verifyPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
    try {
      // Verify signature
      const sign = razorpayOrderId + '|' + razorpayPaymentId;
      const expectedSign = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest('hex');

      const isSignatureValid = razorpaySignature === expectedSign;

      if (!isSignatureValid) {
        return { success: false, error: 'Payment signature verification failed' };
      }

      // Get payment details from Razorpay
      const payment = await this.razorpay.payments.fetch(razorpayPaymentId);
      
      if (payment.status !== 'captured') {
        return { success: false, error: 'Payment not captured' };
      }

      // Update payment status
      const paymentData = this.pendingPayments.get(razorpayOrderId);
      if (paymentData) {
        paymentData.status = 'completed';
        paymentData.paymentId = razorpayPaymentId;
        paymentData.completedAt = new Date().toISOString();
        paymentData.razorpayPayment = payment;
        
        this.pendingPayments.set(razorpayOrderId, paymentData);
      }

      return {
        success: true,
        paymentData,
        razorpayPayment: payment
      };

    } catch (error) {
      console.error('Payment verification error:', error);
      return { 
        success: false, 
        error: 'Payment verification failed. Please contact support.' 
      };
    }
  }

  async checkPaymentStatus(orderId) {
    try {
      const paymentData = this.pendingPayments.get(orderId);
      
      if (!paymentData) {
        return { success: false, error: 'Payment record not found' };
      }

      if (paymentData.status === 'completed') {
        return { success: true, status: 'completed', data: paymentData };
      }

      // Check with Razorpay for latest status
      const order = await this.razorpay.orders.fetch(orderId);
      
      if (order.status === 'paid') {
        // Get payment details
        const payments = await this.razorpay.orders.fetchPayments(orderId);
        
        if (payments.items && payments.items.length > 0) {
          const payment = payments.items[0];
          
          if (payment.status === 'captured') {
            // Update our records
            paymentData.status = 'completed';
            paymentData.paymentId = payment.id;
            paymentData.completedAt = new Date().toISOString();
            paymentData.razorpayPayment = payment;
            
            this.pendingPayments.set(orderId, paymentData);
            
            return { success: true, status: 'completed', data: paymentData };
          }
        }
      }

      return { 
        success: true, 
        status: paymentData.status || 'pending',
        data: paymentData 
      };

    } catch (error) {
      console.error('Error checking payment status:', error);
      return { 
        success: false, 
        error: 'Failed to check payment status' 
      };
    }
  }

  getPaymentByPhoneNumber(phoneNumber) {
    for (const paymentData of this.pendingPayments.values()) {
      if (paymentData.phoneNumber === phoneNumber) {
        return paymentData;
      }
    }
    return null;
  }

  getCompletedPaymentsByPhoneNumber(phoneNumber) {
    const completedPayments = [];
    
    for (const paymentData of this.pendingPayments.values()) {
      if (paymentData.phoneNumber === phoneNumber && paymentData.status === 'completed') {
        completedPayments.push(paymentData);
      }
    }
    
    return completedPayments;
  }

  // Get payment statistics
  getPaymentStats() {
    const stats = {
      total: this.pendingPayments.size,
      completed: 0,
      pending: 0,
      failed: 0,
      totalRevenue: 0,
      todayRevenue: 0
    };

    const today = new Date().toDateString();

    for (const payment of this.pendingPayments.values()) {
      switch (payment.status) {
        case 'completed':
          stats.completed++;
          stats.totalRevenue += payment.amount;
          
          if (payment.completedAt && 
              new Date(payment.completedAt).toDateString() === today) {
            stats.todayRevenue += payment.amount;
          }
          break;
          
        case 'failed':
          stats.failed++;
          break;
          
        default:
          stats.pending++;
      }
    }

    // Convert from paise to rupees
    stats.totalRevenue = stats.totalRevenue / 100;
    stats.todayRevenue = stats.todayRevenue / 100;

    return stats;
  }

  // Create refund (if needed)
  async createRefund(paymentId, amount = null) {
    try {
      const refundOptions = {
        payment_id: paymentId,
        notes: {
          reason: 'Customer request',
          timestamp: new Date().toISOString()
        }
      };

      if (amount) {
        refundOptions.amount = amount; // Amount in paise
      }

      const refund = await this.razorpay.payments.refund(paymentId, refundOptions);
      
      return {
        success: true,
        refund
      };

    } catch (error) {
      console.error('Refund creation error:', error);
      return {
        success: false,
        error: 'Failed to create refund'
      };
    }
  }

  // Webhook handler for Razorpay events
  handleWebhook(payload, signature) {
    try {
      // Verify webhook signature
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
        .update(JSON.stringify(payload))
        .digest('hex');

      const isSignatureValid = signature === expectedSignature;

      if (!isSignatureValid) {
        console.error('Invalid webhook signature');
        return { success: false, error: 'Invalid signature' };
      }

      const event = payload.event;
      const paymentEntity = payload.payload.payment?.entity;
      const orderEntity = payload.payload.order?.entity;

      console.log(`📦 Webhook received: ${event}`);

      switch (event) {
        case 'payment.captured':
          if (paymentEntity) {
            this.updatePaymentFromWebhook(paymentEntity.order_id, paymentEntity);
          }
          break;

        case 'payment.failed':
          if (paymentEntity) {
            this.markPaymentFailed(paymentEntity.order_id, paymentEntity);
          }
          break;

        case 'order.paid':
          if (orderEntity) {
            console.log(`✅ Order ${orderEntity.id} marked as paid`);
          }
          break;
      }

      return { success: true };

    } catch (error) {
      console.error('Webhook processing error:', error);
      return { success: false, error: 'Webhook processing failed' };
    }
  }

  updatePaymentFromWebhook(orderId, paymentEntity) {
    const paymentData = this.pendingPayments.get(orderId);
    
    if (paymentData) {
      paymentData.status = 'completed';
      paymentData.paymentId = paymentEntity.id;
      paymentData.completedAt = new Date().toISOString();
      paymentData.razorpayPayment = paymentEntity;
      
      this.pendingPayments.set(orderId, paymentData);
      
      console.log(`✅ Payment completed for order ${orderId}`);
      
      // Trigger PDF generation or other post-payment actions
      this.triggerPostPaymentActions(paymentData);
    }
  }

  markPaymentFailed(orderId, paymentEntity) {
    const paymentData = this.pendingPayments.get(orderId);
    
    if (paymentData) {
      paymentData.status = 'failed';
      paymentData.failedAt = new Date().toISOString();
      paymentData.failureReason = paymentEntity.error_reason || 'Unknown error';
      
      this.pendingPayments.set(orderId, paymentData);
      
      console.log(`❌ Payment failed for order ${orderId}: ${paymentData.failureReason}`);
    }
  }

  async triggerPostPaymentActions(paymentData) {
    try {
      // Here you can trigger actions like:
      // - Send confirmation message to user
      // - Generate PDF
      // - Update analytics
      // - Send notifications to admin

      console.log(`🎉 Post-payment actions triggered for ${paymentData.phoneNumber}`);
      
      // Example: You might want to notify your main bot about completed payment
      // This would integrate with your conversation manager
      
    } catch (error) {
      console.error('Error in post-payment actions:', error);
    }
  }

  // Cleanup old payments (older than 7 days)
  cleanupOldPayments() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    let cleanedCount = 0;
    
    for (const [orderId, payment] of this.pendingPayments.entries()) {
      const createdAt = new Date(payment.createdAt);
      
      // Keep completed payments and recent payments
      if (createdAt < sevenDaysAgo && payment.status !== 'completed') {
        this.pendingPayments.delete(orderId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old pending payments`);
    }
  }

  // Export payment data
  exportPayments(startDate = null, endDate = null) {
    const payments = Array.from(this.pendingPayments.values());
    
    let filteredPayments = payments;
    
    if (startDate) {
      const start = new Date(startDate);
      filteredPayments = filteredPayments.filter(p => 
        new Date(p.createdAt) >= start
      );
    }
    
    if (endDate) {
      const end = new Date(endDate);
      filteredPayments = filteredPayments.filter(p => 
        new Date(p.createdAt) <= end
      );
    }
    
    return filteredPayments.map(payment => ({
      orderId: payment.orderId,
      phoneNumber: payment.phoneNumber,
      amount: payment.amount / 100, // Convert to rupees
      status: payment.status,
      season: payment.analysis?.personal_profile?.season,
      createdAt: payment.createdAt,
      completedAt: payment.completedAt || null,
      paymentId: payment.paymentId || null
    }));
  }
}

module.exports = PaymentManager;