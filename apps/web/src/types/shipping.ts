export interface ShippingMethodOption {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  price: string;
  estimatedDeliveryDays?: number | null;
  isActive: boolean;
  sortOrder: number;
}
