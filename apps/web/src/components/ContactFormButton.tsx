'use client';

import { FormEvent, useState } from 'react';
import { useToast } from '../lib/toast-context';

const initialState = { name: '', email: '', phone: '', message: '' };

/**
 * Floating "Email us" button + modal contact form, shown alongside the
 * WhatsApp button as a second way to reach the store - unlike WhatsApp this
 * has no prerequisite setting, so it's always available. Posts to this
 * app's own /api/contact route (same same-origin-proxy pattern every other
 * client-side form here uses, e.g. WriteReview), which forwards to the
 * API's public /storefront/contact endpoint.
 */
export function ContactFormButton() {
  const { show } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function close() {
    setIsOpen(false);
    setSubmitted(false);
    setForm(initialState);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      show('Please fill in your name, email, and message', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          message: form.message.trim(),
        }),
      });
      if (res.ok) {
        setSubmitted(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      show(data.message ?? 'Could not send your message. Please try again.', 'error');
    } catch {
      show('Could not reach the server. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className="fab-btn fab-btn--contact" onClick={() => setIsOpen(true)} aria-label="Email us">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            fill="#ffffff"
            d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm15.4 2H4.6l7.4 6.2L19.4 6ZM5 18h14V8.1l-7.68 6.44-7.68-6.44V18Z"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Contact us"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 16,
          }}
          onClick={close}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            {submitted ? (
              <>
                <h3 style={{ marginTop: 0 }}>Message sent</h3>
                <p style={{ color: 'var(--color-text-muted)' }}>
                  Thanks for reaching out - we&apos;ll get back to you by email soon.
                </p>
                <button type="button" className="btn" onClick={close}>
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ marginTop: 0 }}>Email us</h3>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1, padding: 4 }}
                  >
                    &times;
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label htmlFor="contact-name" style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.9rem' }}>
                      Name
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      required
                      maxLength={150}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-email" style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.9rem' }}>
                      Email
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      maxLength={255}
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-phone" style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.9rem' }}>
                      Phone (optional)
                    </label>
                    <input
                      id="contact-phone"
                      type="tel"
                      maxLength={30}
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
                    />
                  </div>
                  <div>
                    <label htmlFor="contact-message" style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.9rem' }}>
                      Issue description
                    </label>
                    <textarea
                      id="contact-message"
                      required
                      rows={4}
                      maxLength={5000}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical' }}
                    />
                  </div>
                  <button type="submit" className="btn" disabled={isSubmitting} style={{ alignSelf: 'flex-start' }}>
                    {isSubmitting ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
