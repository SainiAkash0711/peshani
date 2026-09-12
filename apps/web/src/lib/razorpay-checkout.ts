'use client';

// Razorpay's own hosted checkout script - the only client-side artifact
// this integration ever loads. No secret ever appears in this file or
// anywhere else in the browser bundle; only the public key id (returned by
// POST /api/checkout/create) is ever passed to it.
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: string;
  currency: string;
  name: string;
  description?: string;
  prefill?: { email?: string; contact?: string; name?: string };
  theme?: { color?: string };
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

let loadPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment provider. Please try again.'));
    document.body.appendChild(script);
  });
  return loadPromise;
}

export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<void> {
  await loadRazorpayScript();
  if (!window.Razorpay) {
    throw new Error('Could not load the payment provider. Please try again.');
  }
  new window.Razorpay(options).open();
}
