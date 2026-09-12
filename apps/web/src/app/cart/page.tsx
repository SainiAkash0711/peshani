'use client';

import Link from 'next/link';
import { useCart } from '../../lib/cart-context';
import { formatPrice } from '../../lib/format';
import { CartLine } from '../../types/cart';

const STATUS_LABEL: Record<string, string> = {
  PRODUCT_UNAVAILABLE: 'No longer available',
  VARIANT_UNAVAILABLE: 'This option is no longer available',
  OUT_OF_STOCK: 'Out of stock',
  INSUFFICIENT_STOCK: 'Limited stock',
  PRICE_CHANGED: 'Price updated',
};

function CartLineRow({ line }: { line: CartLine }) {
  const { updateItem, removeItem } = useCart();

  return (
    <div className="cart-line">
      <div className="cart-line__media">
        {line.product.image ? <img src={line.product.image} alt={line.product.name} /> : <span className="card__media--empty">No image</span>}
      </div>
      <div className="cart-line__details">
        <Link href={`/products/${line.product.slug}`} className="cart-line__name">
          {line.product.name}
        </Link>
        {line.variant && <div className="cart-line__variant">{line.variant.attributes.join(', ')}</div>}
        {line.status !== 'VALID' && (
          <div className={`badge ${line.status === 'INSUFFICIENT_STOCK' || line.status === 'PRICE_CHANGED' ? 'badge--low-stock' : 'badge--out-of-stock'}`}>
            {STATUS_LABEL[line.status] ?? line.status}
            {line.status === 'INSUFFICIENT_STOCK' && line.availableQuantity !== undefined ? ` - only ${line.availableQuantity} left` : ''}
          </div>
        )}
        <div className="cart-line__mobile-price">{formatPrice(line.unitPrice)}</div>
      </div>
      <div className="cart-line__quantity">
        <button type="button" onClick={() => void updateItem(line.id, Math.max(1, line.quantity - 1))} aria-label="Decrease quantity">
          -
        </button>
        <span>{line.quantity}</span>
        <button type="button" onClick={() => void updateItem(line.id, line.quantity + 1)} aria-label="Increase quantity">
          +
        </button>
      </div>
      <div className="cart-line__price">{formatPrice(line.unitPrice)}</div>
      <div className="cart-line__total">{formatPrice(line.lineTotal)}</div>
      <button type="button" className="cart-line__remove" onClick={() => void removeItem(line.id)} aria-label="Remove item">
        Remove
      </button>
    </div>
  );
}

export default function CartPage() {
  const { cart, isLoading, error, clear, refresh } = useCart();

  if (isLoading) {
    return (
      <main className="container">
        <h1>Your Cart</h1>
        <div className="empty-state">Loading your cart…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="container">
        <h1>Your Cart</h1>
        <div className="empty-state">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="container">
        <h1>Your Cart</h1>
        <div className="empty-state">
          <p>Your cart is empty.</p>
          <Link href="/products" className="btn">
            Continue Shopping
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>Your Cart</h1>
      <div className="cart-layout">
        <div className="cart-lines">
          {cart.items.map((line) => (
            <CartLineRow key={line.id} line={line} />
          ))}
        </div>
        <aside className="cart-summary">
          <div className="cart-summary__row">
            <span>Subtotal ({cart.itemCount} items)</span>
            <strong>{formatPrice(cart.subtotal)}</strong>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Shipping, taxes, and discounts are calculated at checkout.
          </p>
          <Link href="/checkout" className="btn" style={{ width: '100%', textAlign: 'center', marginBottom: 10 }}>
            Proceed to Checkout
          </Link>
          <Link href="/products" className="btn btn--outline" style={{ width: '100%', textAlign: 'center', marginBottom: 10 }}>
            Continue Shopping
          </Link>
          <button type="button" className="btn--outline" style={{ width: '100%', padding: '10px', borderRadius: 8 }} onClick={() => void clear()}>
            Clear Cart
          </button>
        </aside>
      </div>
    </main>
  );
}
