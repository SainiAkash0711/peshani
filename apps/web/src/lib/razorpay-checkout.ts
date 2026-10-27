'use client';

// Razorpay's own hosted checkout script - the only client-side artifact
// this integration ever loads. No secret ever appears in this file or
// anywhere else in the browser bundle; only the public key id (returned by
// POST /api/checkout/create) is ever passed to it.
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

// The API reports this key id when it runs the dummy test gateway
// (PAYMENT_MODE=mock) instead of Razorpay.
const MOCK_KEY_PREFIX = 'mock_';

declare global {
  interface Window {
    Razorpay?: new (options: Omit<RazorpayCheckoutOptions, 'orderNumber'>) => { open: () => void };
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
  /** Used only by the dummy test gateway to ask the server to confirm the payment; never sent to Razorpay. */
  orderNumber?: string;
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

function formatMinorUnits(amount: string, currency: string): string {
  const value = Number(amount) / 100;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function el(tag: string, style: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.setAttribute('style', style);
  if (text) node.textContent = text;
  return node;
}

/**
 * A stand-in for Razorpay's payment window that moves no money. It looks like
 * a payment popup but says plainly that it is a test, and "Pay" simply asks
 * the server (which only allows this in mock mode) for a signed confirmation
 * that then goes through the normal payment verification.
 */
function openMockCheckout(options: RazorpayCheckoutOptions): void {
  const amountLabel = formatMinorUnits(options.amount, options.currency);

  const overlay = el('div', 'position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(10,30,20,.6);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Test payment');

  const card = el('div', 'width:420px;max-width:100%;overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 30px 80px rgba(0,0,0,.35)');
  const header = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(135deg,#0b5c3c,#0f7a4f);color:#fff');
  header.appendChild(el('strong', 'font-size:17px', options.name));
  header.appendChild(el('span', 'padding:3px 10px;border-radius:999px;background:#fbbf24;color:#5b3a00;font-size:11px;font-weight:800;letter-spacing:.08em', 'TEST MODE'));

  const body = el('div', 'padding:22px 22px 8px');
  body.appendChild(el('div', 'font-size:13px;color:#64756c', options.description ?? 'Payment'));
  body.appendChild(el('div', 'margin:6px 0 14px;font-size:34px;font-weight:800;color:#1c2a22', amountLabel));
  body.appendChild(
    el(
      'div',
      'padding:12px 14px;border-radius:12px;background:#fff7e0;border:1px solid #f3dca0;color:#6b4e00;font-size:13px;line-height:1.5',
      'This is a dummy payment gateway for testing. No real money is charged and no card is needed.',
    ),
  );
  const error = el('div', 'min-height:20px;margin-top:10px;color:#b91c1c;font-size:13px;font-weight:600');
  body.appendChild(error);

  const actions = el('div', 'display:grid;gap:10px;padding:8px 22px 22px');
  const payButton = el('button', 'padding:14px;border:0;border-radius:12px;background:#0f7a4f;color:#fff;font-size:16px;font-weight:700;cursor:pointer', `Pay ${amountLabel} (test)`) as HTMLButtonElement;
  payButton.type = 'button';
  const cancelButton = el('button', 'padding:12px;border:1px solid #d1d5db;border-radius:12px;background:#fff;color:#374151;font-size:15px;font-weight:600;cursor:pointer', 'Cancel') as HTMLButtonElement;
  cancelButton.type = 'button';
  actions.append(payButton, cancelButton);

  card.append(header, body, actions);
  overlay.appendChild(card);

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const cancel = () => {
    close();
    options.modal?.ondismiss?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancel();
  };

  cancelButton.addEventListener('click', cancel);
  payButton.addEventListener('click', async () => {
    payButton.disabled = true;
    cancelButton.disabled = true;
    payButton.textContent = 'Processing…';
    error.textContent = '';
    try {
      const res = await fetch('/api/payments/mock/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber: options.orderNumber, razorpayOrderId: options.order_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'The test payment could not be completed.');
      close();
      options.handler(data);
    } catch (err) {
      error.textContent = (err as Error).message;
      payButton.disabled = false;
      cancelButton.disabled = false;
      payButton.textContent = `Pay ${amountLabel} (test)`;
    }
  });

  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  payButton.focus();
}

export async function openRazorpayCheckout(options: RazorpayCheckoutOptions): Promise<void> {
  if (options.key.startsWith(MOCK_KEY_PREFIX)) {
    openMockCheckout(options);
    return;
  }
  await loadRazorpayScript();
  if (!window.Razorpay) {
    throw new Error('Could not load the payment provider. Please try again.');
  }
  const { orderNumber: _ignored, ...razorpayOptions } = options;
  void _ignored;
  new window.Razorpay(razorpayOptions).open();
}
