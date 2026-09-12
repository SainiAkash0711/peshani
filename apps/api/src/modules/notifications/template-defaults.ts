import { NotificationChannel, NotificationType } from '@prisma/client';

export interface DefaultTemplateContent {
  subject?: string;
  title: string;
  body: string;
}

/**
 * Built-in fallback content for every (NotificationType, NotificationChannel)
 * pair this phase wires up. NotificationTemplateService.getEffective() falls
 * back to these whenever a store has not defined (or has deactivated) its
 * own NotificationTemplate row, so notification delivery never breaks
 * merely because an admin hasn't customized a template yet (§5).
 */
export const DEFAULT_TEMPLATES: Record<NotificationType, Partial<Record<NotificationChannel, DefaultTemplateContent>>> = {
  ORDER_CONFIRMED: {
    IN_APP: { title: 'Order confirmed', body: 'Your order {{orderNumber}} has been confirmed.' },
    EMAIL: {
      subject: 'Your order {{orderNumber}} is confirmed',
      title: 'Order confirmed',
      body: 'Hi {{customerName}}, your order {{orderNumber}} for {{orderTotal}} has been confirmed. We will let you know as soon as it ships.',
    },
  },
  ORDER_CANCELLED: {
    IN_APP: { title: 'Order cancelled', body: 'Your order {{orderNumber}} has been cancelled.' },
    EMAIL: {
      subject: 'Your order {{orderNumber}} was cancelled',
      title: 'Order cancelled',
      body: 'Hi {{customerName}}, your order {{orderNumber}} has been cancelled.',
    },
  },
  ORDER_PACKED: {
    IN_APP: { title: 'Order packed', body: 'Your order {{orderNumber}} has been packed and is ready to ship.' },
    EMAIL: {
      subject: 'Your order {{orderNumber}} has been packed',
      title: 'Order packed',
      body: 'Hi {{customerName}}, your order {{orderNumber}} has been packed and will ship soon.',
    },
  },
  ORDER_SHIPPED: {
    IN_APP: { title: 'Order shipped', body: 'Your order {{orderNumber}} has shipped via {{shippingMethod}}.' },
    EMAIL: {
      subject: 'Your order {{orderNumber}} has shipped',
      title: 'Order shipped',
      body: 'Hi {{customerName}}, your order {{orderNumber}} has shipped via {{shippingMethod}}.',
    },
  },
  ORDER_DELIVERED: {
    IN_APP: { title: 'Order delivered', body: 'Your order {{orderNumber}} has been delivered.' },
    EMAIL: {
      subject: 'Your order {{orderNumber}} has been delivered',
      title: 'Order delivered',
      body: 'Hi {{customerName}}, your order {{orderNumber}} has been delivered. We hope you love it!',
    },
  },
  PAYMENT_SUCCESS: {
    IN_APP: { title: 'Payment received', body: 'We received your payment of {{orderTotal}} for order {{orderNumber}}.' },
    EMAIL: {
      subject: 'Payment received for order {{orderNumber}}',
      title: 'Payment received',
      body: 'Hi {{customerName}}, we received your payment of {{orderTotal}} for order {{orderNumber}}.',
    },
  },
  PAYMENT_FAILED: {
    IN_APP: { title: 'Payment failed', body: 'Your payment for order {{orderNumber}} did not go through. Please try again.' },
    EMAIL: {
      subject: 'Payment failed for order {{orderNumber}}',
      title: 'Payment failed',
      body: 'Hi {{customerName}}, your payment for order {{orderNumber}} did not go through. Please try again from your order history.',
    },
  },
  REVIEW_APPROVED: {
    IN_APP: { title: 'Review published', body: 'Your review for {{productName}} is now live.' },
    EMAIL: {
      subject: 'Your review has been published',
      title: 'Review published',
      body: 'Hi {{customerName}}, your review for {{productName}} has been approved and is now visible to other shoppers.',
    },
  },
  REVIEW_REJECTED: {
    IN_APP: { title: 'Review not published', body: 'Your review for {{productName}} was not approved for publication.' },
    EMAIL: {
      subject: 'Update on your recent review',
      title: 'Review not published',
      body: 'Hi {{customerName}}, your review for {{productName}} was not approved for publication.',
    },
  },
  PROMOTION_AVAILABLE: {
    IN_APP: { title: 'New promotion available', body: '{{promotionName}} is now available.' },
    EMAIL: {
      subject: 'A new promotion is available',
      title: 'New promotion available',
      body: 'Hi {{customerName}}, {{promotionName}} is now available.',
    },
  },
  COUPON_AVAILABLE: {
    IN_APP: { title: 'New coupon available', body: 'Use code {{couponCode}} on your next order.' },
    EMAIL: {
      subject: 'A new coupon is available for you',
      title: 'New coupon available',
      body: 'Hi {{customerName}}, use code {{couponCode}} on your next order.',
    },
  },
  RETURN_REQUESTED: {
    IN_APP: { title: 'Return request received', body: 'We received your return request for order {{orderNumber}}.' },
    EMAIL: {
      subject: 'Your return request for order {{orderNumber}} was received',
      title: 'Return request received',
      body: 'Hi {{customerName}}, we received your return request for order {{orderNumber}} and will review it shortly.',
    },
  },
  RETURN_APPROVED: {
    IN_APP: { title: 'Return approved', body: 'Your return for order {{orderNumber}} has been approved.' },
    EMAIL: {
      subject: 'Your return for order {{orderNumber}} was approved',
      title: 'Return approved',
      body: 'Hi {{customerName}}, your return for order {{orderNumber}} has been approved. Please send the item(s) back to us.',
    },
  },
  RETURN_REJECTED: {
    IN_APP: { title: 'Return not approved', body: 'Your return request for order {{orderNumber}} was not approved.' },
    EMAIL: {
      subject: 'Update on your return request for order {{orderNumber}}',
      title: 'Return not approved',
      body: 'Hi {{customerName}}, your return request for order {{orderNumber}} was not approved.',
    },
  },
  RETURN_RECEIVED: {
    IN_APP: { title: 'Return received', body: 'We received your returned item(s) for order {{orderNumber}}.' },
    EMAIL: {
      subject: 'We received your return for order {{orderNumber}}',
      title: 'Return received',
      body: 'Hi {{customerName}}, we received your returned item(s) for order {{orderNumber}} and will process your refund soon.',
    },
  },
  REFUND_INITIATED: {
    IN_APP: { title: 'Refund initiated', body: 'A refund of {{amount}} has been initiated for order {{orderNumber}}.' },
    EMAIL: {
      subject: 'Your refund for order {{orderNumber}} has been initiated',
      title: 'Refund initiated',
      body: 'Hi {{customerName}}, a refund of {{amount}} has been initiated for order {{orderNumber}}.',
    },
  },
  REFUND_SUCCEEDED: {
    IN_APP: { title: 'Refund completed', body: 'Your refund of {{amount}} for order {{orderNumber}} is complete.' },
    EMAIL: {
      subject: 'Your refund for order {{orderNumber}} is complete',
      title: 'Refund completed',
      body: 'Hi {{customerName}}, your refund of {{amount}} for order {{orderNumber}} has been completed.',
    },
  },
  REFUND_FAILED: {
    IN_APP: { title: 'Refund issue', body: 'We could not process your refund for order {{orderNumber}}. Our team has been notified.' },
    EMAIL: {
      subject: 'An issue occurred with your refund for order {{orderNumber}}',
      title: 'Refund issue',
      body: 'Hi {{customerName}}, we could not process your refund for order {{orderNumber}}. Our team has been notified and will follow up.',
    },
  },
};
