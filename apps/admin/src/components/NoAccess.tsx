import { cardStyle } from '../styles';

/**
 * Shown when a user without the required permission somehow lands on a
 * gated page directly by URL (nav already hides the link, but routes are
 * still reachable by typing the address).
 */
export function NoAccess({ message = "You don't have permission to view this page." }: { message?: string }) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', color: '#6b7280' }}>
      <p style={{ margin: 0, fontSize: 14 }}>{message}</p>
    </div>
  );
}
