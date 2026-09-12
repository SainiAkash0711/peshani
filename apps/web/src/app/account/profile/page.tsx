'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../lib/toast-context';

interface ProfileAddress {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

interface Profile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  address: ProfileAddress | null;
}

const EMPTY_ADDRESS: ProfileAddress = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
};

export default function ProfilePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { show } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [address, setAddress] = useState<ProfileAddress>(EMPTY_ADDRESS);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    fetch('/api/auth/profile', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Profile | null) => {
        if (!data) return;
        setProfile(data);
        setFirstName(data.firstName ?? '');
        setLastName(data.lastName ?? '');
        setPhone(data.phone ?? '');
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.slice(0, 10) : '');
        setGender(data.gender ?? '');
        setAddress({ ...EMPTY_ADDRESS, ...(data.address ?? {}) });
      })
      .finally(() => setIsLoading(false));
  }, [authLoading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          phone: phone || undefined,
          dateOfBirth: dateOfBirth || undefined,
          gender: gender || undefined,
          // Omit entirely if every field is blank, so a brand-new profile
          // doesn't send an empty-but-present address object.
          address: Object.values(address).some(Boolean) ? address : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(Array.isArray(data.message) ? data.message[0] : data.message ?? 'Could not save your profile.', 'error');
        return;
      }
      setProfile(data);
      show('Profile updated');
    } catch {
      show('Could not reach the server. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || !user || isLoading) {
    return (
      <main className="container" style={{ maxWidth: 640 }}>
        <h1>My Profile</h1>
        <div className="empty-state">Loading…</div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="container" style={{ maxWidth: 640 }}>
        <h1>My Profile</h1>
        <div className="empty-state">
          <p>We couldn&apos;t load your profile. Please try again.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>My Profile</h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Email</label>
          <input className="field" type="email" value={profile.email} disabled />
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>First name</label>
            <input className="field" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Last name</label>
            <input className="field" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Phone number</label>
            <input className="field" type="tel" placeholder="+14155552671" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Date of birth</label>
            <input className="field" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Gender</label>
          <select className="field" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Prefer not to say</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
            <option value="PREFER_NOT_TO_SAY">Prefer not to say (explicit)</option>
          </select>
        </div>

        <div>
          <h2 style={{ fontSize: '1.05rem', marginBottom: 12 }}>Address</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="field"
              type="text"
              placeholder="Address line 1"
              value={address.addressLine1 ?? ''}
              onChange={(e) => setAddress({ ...address, addressLine1: e.target.value })}
            />
            <input
              className="field"
              type="text"
              placeholder="Address line 2 (optional)"
              value={address.addressLine2 ?? ''}
              onChange={(e) => setAddress({ ...address, addressLine2: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input
                className="field"
                style={{ flex: 1, minWidth: 140 }}
                type="text"
                placeholder="City"
                value={address.city ?? ''}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
              <input
                className="field"
                style={{ flex: 1, minWidth: 140 }}
                type="text"
                placeholder="State"
                value={address.state ?? ''}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input
                className="field"
                style={{ flex: 1, minWidth: 140 }}
                type="text"
                placeholder="Postal code"
                value={address.postalCode ?? ''}
                onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
              />
              <input
                className="field"
                style={{ flex: 1, minWidth: 140 }}
                type="text"
                placeholder="Country"
                value={address.country ?? ''}
                onChange={(e) => setAddress({ ...address, country: e.target.value })}
              />
            </div>
          </div>
        </div>

        <button type="submit" className="btn" disabled={saving} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </main>
  );
}
