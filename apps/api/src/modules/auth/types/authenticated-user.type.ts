export interface AuthenticatedUser {
  userId: string;
  storeId: string;
  email: string;
  type: 'CUSTOMER' | 'ADMIN';
  roles: string[];
  permissions: string[];
}
